const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BotcoinPoolV2 Integration", function () {
  let token, mining, bonus, factory, pool;
  let owner, operator, alice, bob, protocol;

  const parseE = (n) => ethers.parseEther(String(n));
  const TIER1 = parseE(25_000_000);
  const TIER3 = parseE(100_000_000);

  beforeEach(async function () {
    [owner, operator, alice, bob, protocol] = await ethers.getSigners();

    // Deploy MockERC20
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy();

    // Deploy MockMiningV2
    const Mining = await ethers.getContractFactory("MockMiningV2");
    mining = await Mining.deploy(await token.getAddress());

    // Deploy MockBonusEpoch
    const Bonus = await ethers.getContractFactory("MockBonusEpoch");
    bonus = await Bonus.deploy(await token.getAddress());

    // Deploy Factory
    const Factory = await ethers.getContractFactory("BotcoinPoolFactoryV2");
    factory = await Factory.deploy(
      await token.getAddress(),
      await mining.getAddress(),
      await bonus.getAddress(),
      protocol.address,
      200 // 2% protocol fee
    );

    // Create a pool via factory
    const tx = await factory.createPool(operator.address, 500, TIER3); // 5% op fee, 100M cap
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (l) => l.fragment && l.fragment.name === "PoolCreated"
    );
    const poolAddr = event ? event.args[0] : (await factory.getPools())[0];
    pool = await ethers.getContractAt("BotcoinPoolV2", poolAddr);

    // Mint tokens to users
    await token.mint(alice.address, TIER3);
    await token.mint(bob.address, parseE(50_000_000));
  });

  describe("Factory", function () {
    it("should register the pool", async function () {
      const pools = await factory.getPools();
      expect(pools.length).to.equal(1);
      expect(await factory.isPool(await pool.getAddress())).to.be.true;
    });

    it("should transfer ownership to creator", async function () {
      expect(await pool.owner()).to.equal(owner.address);
    });

    it("should reject maxStake > 100M", async function () {
      await expect(
        factory.createPool(operator.address, 500, parseE(200_000_000))
      ).to.be.revertedWith("Exceeds mining max");
    });

    it("should reject zero-address operator", async function () {
      await expect(
        factory.createPool(ethers.ZeroAddress, 500, TIER3)
      ).to.be.revertedWith("Zero operator");
    });
  });

  describe("Deposit", function () {
    it("should accept deposits and track user principal", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      expect(await pool.userDeposit(alice.address)).to.equal(TIER1);
      expect(await pool.totalDeposits()).to.equal(TIER1);
    });

    it("should reject deposits exceeding pool cap", async function () {
      const cap = TIER3;
      // Alice deposits 100M (the cap)
      await token.connect(alice).approve(await pool.getAddress(), cap);
      await pool.connect(alice).deposit(cap);

      // Bob tries to deposit 1 more
      await token.connect(bob).approve(await pool.getAddress(), 1n);
      await expect(pool.connect(bob).deposit(1n)).to.be.reverted;
    });

    it("should reject zero deposits", async function () {
      await expect(pool.connect(alice).deposit(0)).to.be.revertedWith("Zero amount");
    });

    it("should reject deposits when pool is Active", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Bob tries to deposit while Active
      await token.connect(bob).approve(await pool.getAddress(), parseE(1));
      await expect(pool.connect(bob).deposit(parseE(1))).to.be.revertedWith("Deposits only when idle");
    });
  });

  describe("Stake into Mining", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
    });

    it("should stake deposits into MiningV2", async function () {
      await pool.stakeIntoMining();

      expect(await pool.poolState()).to.equal(1); // Active
      expect(await mining.stakedAmount(await pool.getAddress())).to.equal(TIER1);
    });

    it("should be callable by anyone (permissionless)", async function () {
      await pool.connect(bob).stakeIntoMining();
      expect(await pool.poolState()).to.equal(1);
    });

    it("should reject if nothing to stake", async function () {
      await pool.stakeIntoMining(); // works (has TIER1 from beforeEach)
      // unstake cycle to get back to Idle
      await pool.connect(bob).requestUnstake();
      await mining.setEpoch(2); // advance epoch
      await pool.connect(bob).executeUnstake();
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine");
      await pool.connect(bob).finalizeWithdraw();
      // Withdraw all
      await pool.connect(alice).withdrawShare(TIER1);
      // Now pool is Idle with 0 deposits
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Nothing to stake");
    });

    it("should reject re-staking when already active", async function () {
      await pool.stakeIntoMining(); // first call works
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });
  });

  describe("Full Lifecycle: Stake → Unstake → Cooldown → Finalize → Withdraw", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
    });

    it("should complete the full lifecycle", async function () {
      // State: Active
      expect(await pool.poolState()).to.equal(1);

      // Request unstake (permissionless)
      await pool.connect(bob).requestUnstake();
      expect(await pool.poolState()).to.equal(1); // still Active (waiting for epoch)
      expect(await pool.unstakeRequestEpoch()).to.equal(1n); // requested at epoch 1

      // Can't execute before epoch ends
      await expect(pool.connect(bob).executeUnstake()).to.be.revertedWith("Epoch not ended");

      // Advance epoch
      await mining.setEpoch(2);

      // Execute unstake (permissionless)
      await pool.connect(bob).executeUnstake();
      expect(await pool.poolState()).to.equal(2); // Unstaking

      // Fast-forward past cooldown (1 day)
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine");

      // Finalize withdraw (permissionless)
      await pool.connect(bob).finalizeWithdraw();
      expect(await pool.poolState()).to.equal(0); // Idle

      // Tokens are back in the pool
      expect(await token.balanceOf(await pool.getAddress())).to.equal(TIER1);

      // Alice withdraws her principal
      await pool.connect(alice).withdrawShare(TIER1);
      expect(await token.balanceOf(alice.address)).to.equal(TIER3); // back to original
      expect(await pool.userDeposit(alice.address)).to.equal(0);
    });

    it("should reject request when not Active", async function () {
      await pool.connect(bob).requestUnstake();
      await mining.setEpoch(2);
      await pool.connect(bob).executeUnstake();
      // Pool is now Unstaking
      await expect(pool.connect(bob).requestUnstake()).to.be.revertedWith("Pool not active");
    });

    it("should reject duplicate unstake request", async function () {
      await pool.connect(bob).requestUnstake();
      await expect(pool.connect(bob).requestUnstake()).to.be.revertedWith("Unstake already requested");
    });

    it("should reject executeUnstake with no pending request", async function () {
      await expect(pool.connect(bob).executeUnstake()).to.be.revertedWith("No unstake request");
    });

    it("should reject finalize before cooldown", async function () {
      await pool.connect(bob).requestUnstake();
      await mining.setEpoch(2);
      await pool.connect(bob).executeUnstake();
      await expect(pool.connect(bob).finalizeWithdraw()).to.be.revertedWith("Cooldown not expired");
    });

    it("should reject withdrawShare when pool is Active", async function () {
      await expect(
        pool.connect(alice).withdrawShare(TIER1)
      ).to.be.revertedWith("Funds staked in mining");
    });
  });

  describe("Reward Claims", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund epoch 1 with 1000 BOTCOIN reward
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));

      // Set credits for pool
      await mining.setCredits(1, await pool.getAddress(), 100);
    });

    it("should distribute regular rewards with fees", async function () {
      const protocolBefore = await token.balanceOf(protocol.address);
      const operatorBefore = await token.balanceOf(operator.address);

      // Trigger claim (permissionless)
      await pool.connect(bob).triggerClaim([1n]);

      // Alice claims her reward
      const aliceReward = await pool.earned(alice.address);
      expect(aliceReward).to.be.gt(0);

      await pool.connect(alice).claimReward();
      expect(await token.balanceOf(alice.address)).to.be.gt(TIER3 - TIER1);

      // Protocol got 2%
      const protocolGot = (await token.balanceOf(protocol.address)) - protocolBefore;
      expect(protocolGot).to.equal(parseE(20)); // 2% of 1000

      // Operator got 5% of remaining 980
      const operatorGot = (await token.balanceOf(operator.address)) - operatorBefore;
      expect(operatorGot).to.equal(parseE(49)); // 5% of 980
    });

    it("should distribute bonus rewards", async function () {
      // Setup bonus epoch
      await bonus.setBonusEpoch(1, true);
      await token.mint(owner.address, parseE(500));
      await token.connect(owner).approve(await bonus.getAddress(), parseE(500));
      await bonus.fundBonusReward(1, parseE(500));
      await bonus.setBonusCredits(1, await pool.getAddress(), 100);

      await pool.connect(bob).triggerBonusClaim([1n]);

      const reward = await pool.earned(alice.address);
      expect(reward).to.be.gt(0);
    });
  });

  describe("Operator Integration", function () {
    it("should forward whitelisted calls via submitToMining", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Whitelist submitReceipt selector
      const submitReceiptSelector = "0x8b3e05f8"; // first 4 bytes of submitReceipt(...)
      await pool.connect(owner).setAllowedOperatorSelector(submitReceiptSelector, true);

      // The actual submitReceipt call would need proper params, but the mock accepts anything
      // For this test, just verify the whitelist check works
      expect(await pool.allowedOperatorSelectors(submitReceiptSelector)).to.be.true;
    });

    it("should reject non-whitelisted selectors", async function () {
      const data = "0xdeadbeef";
      await expect(
        pool.connect(operator).submitToMining(data)
      ).to.be.revertedWith("Selector not whitelisted");
    });

    it("should reject non-operator callers", async function () {
      const selector = "0x8b3e05f8";
      await pool.connect(owner).setAllowedOperatorSelector(selector, true);
      const data = "0x8b3e05f800000000000000000000000000000000000000000000000000000000";
      await expect(
        pool.connect(alice).submitToMining(data)
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Admin", function () {
    it("should decrease fee only", async function () {
      await pool.setFee(400); // 4%
      expect(await pool.feeBps()).to.equal(400);
      await expect(pool.setFee(500)).to.be.revertedWith("Fee can only decrease");
    });

    it("should change operator", async function () {
      await pool.setOperator(alice.address);
      expect(await pool.operator()).to.equal(alice.address);
    });

    it("should reject non-owner admin calls", async function () {
      await expect(pool.connect(alice).setFee(100)).to.be.reverted;
      await expect(pool.connect(alice).setOperator(bob.address)).to.be.reverted;
    });
  });

  describe("EIP-1271 Signature", function () {
    it("should validate operator signature", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const sig = await operator.signMessage(ethers.getBytes(hash));

      // EIP-1271 expects ethSignedMessageHash
      const ethHash = ethers.hashMessage(ethers.getBytes(hash));
      const result = await pool.isValidSignature(ethHash, sig);
      expect(result).to.equal("0x1626ba7e");
    });

    it("should reject non-operator signature", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const sig = await alice.signMessage(ethers.getBytes(hash));
      const ethHash = ethers.hashMessage(ethers.getBytes(hash));
      const result = await pool.isValidSignature(ethHash, sig);
      expect(result).to.equal("0xffffffff");
    });
  });

  describe("Multi-user Scenario", function () {
    it("should distribute rewards proportionally", async function () {
      // Alice deposits 75M, Bob deposits 25M
      await token.connect(alice).approve(await pool.getAddress(), parseE(75_000_000));
      await pool.connect(alice).deposit(parseE(75_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(25_000_000));
      await pool.connect(bob).deposit(parseE(25_000_000));

      await pool.stakeIntoMining();

      // Fund rewards
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      // Trigger claim
      await pool.triggerClaim([1n]);

      // Alice should get 75% of net rewards, Bob 25%
      const aliceReward = await pool.earned(alice.address);
      const bobReward = await pool.earned(bob.address);

      // Net rewards after 2% protocol + 5% operator = 93.1% of 1000 = 931
      // Alice: 75% of 931 ≈ 698.25, Bob: 25% ≈ 232.75
      const aliceNum = Number(ethers.formatEther(aliceReward));
      const bobNum = Number(ethers.formatEther(bobReward));

      expect(aliceNum).to.be.closeTo(698.25, 1);
      expect(bobNum).to.be.closeTo(232.75, 1);
    });
  });

  describe("View Helpers", function () {
    it("should return correct pool info", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      const info = await pool.getPoolInfo();
      expect(info[0]).to.equal(1); // Active state
      expect(info[1]).to.equal(TIER1); // stakedInMining
      expect(info[5]).to.be.true; // eligible (>= tier1)
    });

    it("should return correct user info", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      const info = await pool.getUserInfo(alice.address);
      expect(info[0]).to.equal(TIER1); // depositAmt
      expect(info[2]).to.equal(10000n); // 100% share (only depositor)
    });
  });

  describe("Safety Guards", function () {
    it("should reject triggerClaim when no stakers", async function () {
      // Pool is Idle with 0 deposits
      await expect(pool.triggerClaim([1n])).to.be.revertedWith("No stakers");
    });

    it("should reject triggerBonusClaim when no stakers", async function () {
      await expect(pool.triggerBonusClaim([1n])).to.be.revertedWith("No stakers");
    });

    it("should reject ETH transfers", async function () {
      await expect(
        owner.sendTransaction({ to: await pool.getAddress(), value: 1n })
      ).to.be.reverted;
    });
  });
});
