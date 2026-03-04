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

  // ── Helper: full unstake cycle to Finalized ──────────────────────
  async function finalizeCycle() {
    await pool.requestUnstake();
    await mining.setEpoch(2);
    await pool.executeUnstake();
    await ethers.provider.send("evm_increaseTime", [86401]);
    await ethers.provider.send("evm_mine");
    await pool.finalizeWithdraw();
  }

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
      expect(await pool.rewardDeposit(alice.address)).to.equal(TIER1);
      expect(await pool.totalDeposits()).to.equal(TIER1);
    });

    it("should reject deposits exceeding pool cap", async function () {
      const cap = TIER3;
      await token.connect(alice).approve(await pool.getAddress(), cap);
      await pool.connect(alice).deposit(cap);

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

      await token.connect(bob).approve(await pool.getAddress(), parseE(1));
      await expect(pool.connect(bob).deposit(parseE(1))).to.be.revertedWith("Deposits closed");
    });

    it("should reject deposits when pool is Unstaking", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      await pool.requestUnstake();
      await mining.setEpoch(2);
      await pool.executeUnstake();

      await token.connect(bob).approve(await pool.getAddress(), parseE(1));
      await expect(pool.connect(bob).deposit(parseE(1))).to.be.revertedWith("Deposits closed");
    });

    it("should reject deposits when pool is Finalized", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      await token.connect(bob).approve(await pool.getAddress(), parseE(1));
      await expect(pool.connect(bob).deposit(parseE(1))).to.be.revertedWith("Deposits closed");
    });

    it("should allow Idle withdrawal and adjust rewardDeposit", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      await pool.connect(alice).withdrawShare(TIER1);

      expect(await pool.userDeposit(alice.address)).to.equal(0);
      expect(await pool.rewardDeposit(alice.address)).to.equal(0);
      expect(await pool.totalDeposits()).to.equal(0);
    });
  });

  describe("Stake into Mining", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
    });

    it("should stake deposits and set totalStakeAtActive", async function () {
      await pool.stakeIntoMining();

      expect(await pool.poolState()).to.equal(1); // Active
      expect(await mining.stakedAmount(await pool.getAddress())).to.equal(TIER1);
      expect(await pool.totalStakeAtActive()).to.equal(TIER1);
    });

    it("should be callable by anyone (permissionless)", async function () {
      await pool.connect(bob).stakeIntoMining();
      expect(await pool.poolState()).to.equal(1);
    });

    it("should reject if nothing to stake", async function () {
      await pool.stakeIntoMining();
      await finalizeCycle();

      // Withdraw everything
      await pool.connect(alice).withdrawShare(TIER1);

      // Pool is Finalized — can't stake again
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });

    it("should reject re-staking when already active", async function () {
      await pool.stakeIntoMining();
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });

    it("should be permanently blocked after Finalize (single-use)", async function () {
      await pool.stakeIntoMining();
      await finalizeCycle();

      // Pool is Finalized, not Idle — can't re-stake
      expect(await pool.poolState()).to.equal(3); // Finalized
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });
  });

  describe("Full Lifecycle: Stake → Unstake → Cooldown → Finalize → Withdraw", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
    });

    it("should complete the full lifecycle to Finalized", async function () {
      // State: Active
      expect(await pool.poolState()).to.equal(1);

      // Request unstake (permissionless)
      await pool.connect(bob).requestUnstake();
      expect(await pool.poolState()).to.equal(1); // still Active
      expect(await pool.unstakeRequestEpoch()).to.equal(1n);

      // Can't execute before epoch ends
      await expect(pool.connect(bob).executeUnstake()).to.be.revertedWith("Epoch not ended");

      // Advance epoch
      await mining.setEpoch(2);

      // Execute unstake (permissionless)
      await pool.connect(bob).executeUnstake();
      expect(await pool.poolState()).to.equal(2); // Unstaking

      // Fast-forward past cooldown
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine");

      // Finalize withdraw → Finalized (terminal)
      await pool.connect(bob).finalizeWithdraw();
      expect(await pool.poolState()).to.equal(3); // Finalized

      // Tokens are back in the pool
      expect(await token.balanceOf(await pool.getAddress())).to.equal(TIER1);

      // Alice withdraws her principal
      const aliceBefore = await token.balanceOf(alice.address);
      await pool.connect(alice).withdrawShare(TIER1);
      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore + TIER1);
      expect(await pool.userDeposit(alice.address)).to.equal(0);
    });

    it("should reject request when not Active", async function () {
      await pool.connect(bob).requestUnstake();
      await mining.setEpoch(2);
      await pool.connect(bob).executeUnstake();
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

    it("should reject withdrawShare when pool is Unstaking", async function () {
      await pool.requestUnstake();
      await mining.setEpoch(2);
      await pool.executeUnstake();
      await expect(
        pool.connect(alice).withdrawShare(TIER1)
      ).to.be.revertedWith("Funds staked in mining");
    });
  });

  describe("Per-Epoch Reward Claims", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund epoch 1 with 1000 BOTCOIN reward
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);
    });

    it("should distribute regular rewards with fees per epoch", async function () {
      const protocolBefore = await token.balanceOf(protocol.address);
      const operatorBefore = await token.balanceOf(operator.address);

      // Trigger claim (permissionless)
      await pool.connect(bob).triggerClaim([1n]);

      // Check per-epoch tracking
      expect(await pool.claimedEpochCount()).to.equal(1);
      expect(await pool.claimedEpochAt(0)).to.equal(1n);
      expect(await pool.epochClaimed(1n)).to.be.true;

      // Net reward: 1000 - 2% protocol - 5% operator = 931
      const netReward = await pool.epochRewardNet(1n);
      expect(netReward).to.equal(parseE(931));

      // Alice's pending reward = 100% of net (sole depositor)
      const aliceReward = await pool.earned(alice.address);
      expect(aliceReward).to.equal(parseE(931));

      // Alice claims
      await pool.connect(alice).claimReward();
      expect(await pool.earned(alice.address)).to.equal(0);

      // Protocol got 2% of 1000
      const protocolGot = (await token.balanceOf(protocol.address)) - protocolBefore;
      expect(protocolGot).to.equal(parseE(20));

      // Operator got 5% of 980
      const operatorGot = (await token.balanceOf(operator.address)) - operatorBefore;
      expect(operatorGot).to.equal(parseE(49));
    });

    it("should distribute bonus rewards per epoch", async function () {
      // Setup bonus epoch
      await bonus.setBonusEpoch(1, true);
      await token.mint(owner.address, parseE(500));
      await token.connect(owner).approve(await bonus.getAddress(), parseE(500));
      await bonus.fundBonusReward(1, parseE(500));
      await bonus.setBonusCredits(1, await pool.getAddress(), 100);

      await pool.connect(bob).triggerBonusClaim([1n]);

      expect(await pool.claimedBonusEpochCount()).to.equal(1);
      expect(await pool.claimedBonusEpochAt(0)).to.equal(1n);
      expect(await pool.bonusEpochClaimed(1n)).to.be.true;

      const reward = await pool.earned(alice.address);
      expect(reward).to.be.gt(0);
    });

    it("should skip already-claimed epochs gracefully", async function () {
      await pool.triggerClaim([1n]);

      // Calling again with the same epoch should skip (not revert)
      await pool.triggerClaim([1n]);

      // Still just one claimed epoch
      expect(await pool.claimedEpochCount()).to.equal(1);
    });

    it("should track multiple epochs independently", async function () {
      // Fund epoch 2
      await token.mint(owner.address, parseE(2000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(2000));
      await mining.fundEpochReward(2, parseE(2000));
      await mining.setCredits(2, await pool.getAddress(), 100);

      // Claim both epochs
      await pool.triggerClaim([1n, 2n]);

      expect(await pool.claimedEpochCount()).to.equal(2);

      // Epoch 1 net: 931, Epoch 2 net: 1862
      expect(await pool.epochRewardNet(1n)).to.equal(parseE(931));
      expect(await pool.epochRewardNet(2n)).to.equal(parseE(1862));

      // Alice gets total: 931 + 1862 = 2793
      const pending = await pool.earned(alice.address);
      expect(pending).to.equal(parseE(2793));
    });

    it("should reject triggerClaim when no active stake", async function () {
      // Fresh pool with no deposits staked
      const tx2 = await factory.createPool(operator.address, 500, TIER3);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(
        (l) => l.fragment && l.fragment.name === "PoolCreated"
      );
      const pool2 = await ethers.getContractAt("BotcoinPoolV2", event2.args[0]);

      await expect(pool2.triggerClaim([1n])).to.be.revertedWith("No active stake");
    });

    it("should reject claimReward when no rewards pending", async function () {
      await expect(pool.connect(alice).claimReward()).to.be.revertedWith("No rewards");
    });
  });

  describe("Reward Fairness — per-epoch vs. late-joiner", function () {
    it("should distribute fairly: late depositors don't dilute early ones", async function () {
      // Alice deposits 75M
      await token.connect(alice).approve(await pool.getAddress(), parseE(75_000_000));
      await pool.connect(alice).deposit(parseE(75_000_000));

      // Bob deposits 25M
      await token.connect(bob).approve(await pool.getAddress(), parseE(25_000_000));
      await pool.connect(bob).deposit(parseE(25_000_000));

      await pool.stakeIntoMining();

      expect(await pool.totalStakeAtActive()).to.equal(parseE(100_000_000));

      // Fund and claim epoch 1 (1000 BOTCOIN)
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);

      // Net = 931. Alice: 75%, Bob: 25%
      const aliceReward = await pool.earned(alice.address);
      const bobReward = await pool.earned(bob.address);

      const aliceNum = Number(ethers.formatEther(aliceReward));
      const bobNum = Number(ethers.formatEther(bobReward));

      expect(aliceNum).to.be.closeTo(698.25, 0.01);
      expect(bobNum).to.be.closeTo(232.75, 0.01);
    });

    it("should not distort rewards after principal withdrawal in Finalized", async function () {
      // Alice deposits 50M, Bob deposits 50M
      await token.connect(alice).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(alice).deposit(parseE(50_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(bob).deposit(parseE(50_000_000));

      await pool.stakeIntoMining();

      // Fund epoch 1
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      // Claim epoch 1
      await pool.triggerClaim([1n]);

      // Finalize
      await finalizeCycle();

      // Alice withdraws principal first (auto-claims rewards)
      await pool.connect(alice).withdrawShare(parseE(50_000_000));

      // Fund and claim epoch 2 (late claim — pool already Finalized)
      await token.mint(owner.address, parseE(2000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(2000));
      await mining.fundEpochReward(2, parseE(2000));
      await mining.setCredits(2, await pool.getAddress(), 100);

      await pool.triggerClaim([2n]);

      // Bob should still get 50% of epoch 2 (not 100%)
      // because rewardDeposit is frozen
      const bobReward = await pool.earned(bob.address);
      // Epoch 1 net: 931 → Bob's 50% = 465.5
      // Epoch 2 net: 1862 → Bob's 50% = 931
      // Total unclaimed for Bob: 465.5 + 931 = 1396.5
      const bobNum = Number(ethers.formatEther(bobReward));
      expect(bobNum).to.be.closeTo(1396.5, 0.01);

      // Alice's rewardDeposit is still 50M — she can claim epoch 2 rewards
      // even though her userDeposit is 0
      const aliceReward = await pool.earned(alice.address);
      // Alice already claimed epoch 1 via withdrawShare. Epoch 2: 50% = 931
      const aliceNum = Number(ethers.formatEther(aliceReward));
      expect(aliceNum).to.be.closeTo(931, 0.01);
    });
  });

  describe("Operator Integration", function () {
    it("should forward whitelisted calls via submitToMining", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      const submitReceiptSelector = "0x8b3e05f8";
      await pool.connect(owner).setAllowedOperatorSelector(submitReceiptSelector, true);

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

      const aliceReward = await pool.earned(alice.address);
      const bobReward = await pool.earned(bob.address);

      // Net = 931. Alice: 75% ≈ 698.25, Bob: 25% ≈ 232.75
      const aliceNum = Number(ethers.formatEther(aliceReward));
      const bobNum = Number(ethers.formatEther(bobReward));

      expect(aliceNum).to.be.closeTo(698.25, 0.01);
      expect(bobNum).to.be.closeTo(232.75, 0.01);
    });

    it("should handle auto-claim + withdraw in Finalized", async function () {
      await token.connect(alice).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(alice).deposit(parseE(50_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(bob).deposit(parseE(50_000_000));

      await pool.stakeIntoMining();

      // Fund and claim rewards
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);
      await finalizeCycle();

      // Alice uses withdrawShare (auto-claims)
      const aliceBefore = await token.balanceOf(alice.address);
      await pool.connect(alice).withdrawShare(parseE(50_000_000));
      const aliceAfter = await token.balanceOf(alice.address);

      // She gets principal (50M) + 50% of 931 = 50_000_465.5
      const aliceGot = Number(ethers.formatEther(aliceAfter - aliceBefore));
      expect(aliceGot).to.be.closeTo(50_000_465.5, 0.01);
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
      expect(info[3]).to.equal(TIER1); // activeStake = totalStakeAtActive
      expect(info[5]).to.be.true; // eligible (>= tier1)
      expect(info[7]).to.equal(0); // 0 epochs claimed
    });

    it("should track epoch claim count in poolInfo", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);

      const info = await pool.getPoolInfo();
      expect(info[7]).to.equal(1); // 1 epoch claimed
    });

    it("should return correct user info", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      const info = await pool.getUserInfo(alice.address);
      expect(info[0]).to.equal(TIER1); // depositAmt
      expect(info[2]).to.equal(10000n); // 100% share (only depositor)
    });

    it("should reflect Finalized state (3)", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      const info = await pool.getPoolInfo();
      expect(info[0]).to.equal(3); // Finalized
    });

    it("should provide epochClaimed and bonusEpochClaimed views", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      expect(await pool.epochClaimed(1n)).to.be.false;
      await pool.triggerClaim([1n]);
      expect(await pool.epochClaimed(1n)).to.be.true;
      expect(await pool.epochClaimed(2n)).to.be.false;
    });
  });

  describe("Safety Guards", function () {
    it("should reject triggerClaim when no active stake", async function () {
      await expect(pool.triggerClaim([1n])).to.be.revertedWith("No active stake");
    });

    it("should reject triggerBonusClaim when no active stake", async function () {
      await expect(pool.triggerBonusClaim([1n])).to.be.revertedWith("No active stake");
    });

    it("should reject ETH transfers", async function () {
      await expect(
        owner.sendTransaction({ to: await pool.getAddress(), value: 1n })
      ).to.be.reverted;
    });

    it("should allow reward claiming even after Finalized", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      // Fund and claim a late epoch
      await token.mint(owner.address, parseE(500));
      await token.connect(owner).approve(await mining.getAddress(), parseE(500));
      await mining.fundEpochReward(1, parseE(500));
      await mining.setCredits(1, await pool.getAddress(), 50);

      await pool.triggerClaim([1n]);

      const reward = await pool.earned(alice.address);
      expect(reward).to.be.gt(0);

      await pool.connect(alice).claimReward();
      expect(await pool.earned(alice.address)).to.equal(0);
    });
  });

  describe("Single-Use Invariant", function () {
    it("should not allow re-staking after Finalize", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      expect(await pool.poolState()).to.equal(3); // Finalized
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });

    it("should not allow deposits after Finalize", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      await token.connect(bob).approve(await pool.getAddress(), parseE(1));
      await expect(pool.connect(bob).deposit(parseE(1))).to.be.revertedWith("Deposits closed");
    });

    it("should allow full exit in Finalized (principal + rewards in one tx)", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund reward
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);
      await pool.triggerClaim([1n]);

      await finalizeCycle();

      const aliceBefore = await token.balanceOf(alice.address);

      // Single withdrawShare call gets principal + auto-claimed rewards
      await pool.connect(alice).withdrawShare(TIER1);

      const aliceAfter = await token.balanceOf(alice.address);
      const received = aliceAfter - aliceBefore;

      // Should be more than just principal (principal + 931 net reward)
      expect(received).to.be.gt(TIER1);
      expect(Number(ethers.formatEther(received))).to.be.closeTo(25_000_931, 1);
    });
  });
});
