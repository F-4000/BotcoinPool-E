const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BotcoinPoolV3 Integration", function () {
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

    // Deploy MockMiningV3
    const Mining = await ethers.getContractFactory("MockMiningV3");
    mining = await Mining.deploy(await token.getAddress());

    // Deploy MockBonusEpoch (reuse from V2 — same interface)
    const Bonus = await ethers.getContractFactory("MockBonusEpoch");
    bonus = await Bonus.deploy(await token.getAddress());

    // Deploy Factory V3
    const Factory = await ethers.getContractFactory("BotcoinPoolFactoryV3");
    factory = await Factory.deploy(
      await token.getAddress(),
      await mining.getAddress(),
      await bonus.getAddress(),
      protocol.address,
      200 // 2% protocol fee
    );

    // Create a pool via factory
    const tx = await factory.createPool(operator.address, 500, TIER3, 0);
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (l) => l.fragment && l.fragment.name === "PoolCreated"
    );
    const poolAddr = event ? event.args[0] : (await factory.getPools())[0];
    pool = await ethers.getContractAt("BotcoinPoolV3", poolAddr);

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

  // ═══════════════════════════════════════════════════════════════════
  //  FACTORY
  // ═══════════════════════════════════════════════════════════════════

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
        factory.createPool(operator.address, 500, parseE(200_000_000), 0)
      ).to.be.revertedWith("Exceeds mining max");
    });

    it("should reject zero-address operator", async function () {
      await expect(
        factory.createPool(ethers.ZeroAddress, 500, TIER3, 0)
      ).to.be.revertedWith("Zero operator");
    });

    it("should return correct pool count", async function () {
      expect(await factory.getPoolCount()).to.equal(1);
      await factory.createPool(operator.address, 300, TIER1, 0);
      expect(await factory.getPoolCount()).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  DEPOSIT
  // ═══════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════
  //  V3: TIER-1 THRESHOLD ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════

  describe("Tier-1 Threshold (V3)", function () {
    it("should reject stakeIntoMining below tier-1 minimum", async function () {
      // Tier1 = 25M. Deposit only 10M.
      const amount = parseE(10_000_000);
      await token.connect(alice).approve(await pool.getAddress(), amount);
      await pool.connect(alice).deposit(amount);

      await expect(pool.stakeIntoMining()).to.be.revertedWith("Below tier 1 minimum");
    });

    it("should allow staking at exactly tier-1", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      await pool.stakeIntoMining();
      expect(await pool.poolState()).to.equal(1); // Active
    });

    it("should allow staking above tier-1", async function () {
      const amount = parseE(50_000_000);
      await token.connect(alice).approve(await pool.getAddress(), amount);
      await pool.connect(alice).deposit(amount);

      await pool.stakeIntoMining();
      expect(await pool.poolState()).to.equal(1);
    });

    it("should respect dynamic tier-1 changes", async function () {
      // Lower tier1 to 10M
      await mining.setTier1Balance(parseE(10_000_000));

      const amount = parseE(10_000_000);
      await token.connect(alice).approve(await pool.getAddress(), amount);
      await pool.connect(alice).deposit(amount);

      await pool.stakeIntoMining();
      expect(await pool.poolState()).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  STAKE INTO MINING
  // ═══════════════════════════════════════════════════════════════════

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

    it("should reject re-staking when already active", async function () {
      await pool.stakeIntoMining();
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });

    it("should be permanently blocked after Finalize (single-use)", async function () {
      await pool.stakeIntoMining();
      await finalizeCycle();

      expect(await pool.poolState()).to.equal(3); // Finalized
      await expect(pool.stakeIntoMining()).to.be.revertedWith("Pool not idle");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  FULL LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  describe("Full Lifecycle: Stake → Unstake → Cooldown → Finalize → Withdraw", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
    });

    it("should complete the full lifecycle to Finalized", async function () {
      expect(await pool.poolState()).to.equal(1); // Active

      await pool.connect(bob).requestUnstake();
      expect(await pool.poolState()).to.equal(1);
      expect(await pool.unstakeRequestEpoch()).to.equal(1n);

      await expect(pool.connect(bob).executeUnstake()).to.be.revertedWith("Epoch not ended");

      await mining.setEpoch(2);
      await pool.connect(bob).executeUnstake();
      expect(await pool.poolState()).to.equal(2); // Unstaking

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine");

      await pool.connect(bob).finalizeWithdraw();
      expect(await pool.poolState()).to.equal(3); // Finalized

      expect(await token.balanceOf(await pool.getAddress())).to.equal(TIER1);

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

  // ═══════════════════════════════════════════════════════════════════
  //  V3: POST-CONDITION SAFETY CHECKS
  // ═══════════════════════════════════════════════════════════════════

  describe("Post-condition Safety Checks (V3)", function () {
    it("stakeIntoMining verifies mining accepted the stake", async function () {
      // Normal flow — stake is accepted
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Verify the post-condition was satisfied (stake shows in mining)
      expect(await mining.stakedAmount(await pool.getAddress())).to.equal(TIER1);
    });

    it("executeUnstake verifies withdrawableAt > 0", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      await pool.requestUnstake();
      await mining.setEpoch(2);
      await pool.executeUnstake();

      // After a successful executeUnstake, withdrawableAt should be set
      const wAt = await mining.withdrawableAt(await pool.getAddress());
      expect(wAt).to.be.gt(0);
    });

    it("finalizeWithdraw verifies stakedAmount == 0", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      // After finalize, staked amount in mining should be 0
      expect(await mining.stakedAmount(await pool.getAddress())).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  V3: accRewardPerShare REWARD CLAIMS
  // ═══════════════════════════════════════════════════════════════════

  describe("Reward Claims (accRewardPerShare)", function () {
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

    it("should distribute regular rewards with fees via accRewardPerShare", async function () {
      const protocolBefore = await token.balanceOf(protocol.address);
      const operatorBefore = await token.balanceOf(operator.address);

      await pool.connect(bob).triggerClaim([1n]);

      // Verify epoch is claimed on mining side
      expect(await pool.epochClaimed(1n)).to.be.true;

      // accRewardPerShare should be nonzero
      expect(await pool.accRewardPerShare()).to.be.gt(0);

      // Net reward: 1000 - 2% protocol - 5% operator = 931
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

    it("should distribute bonus rewards via accBonusRewardPerShare", async function () {
      await bonus.setBonusEpoch(1, true);
      await token.mint(owner.address, parseE(500));
      await token.connect(owner).approve(await bonus.getAddress(), parseE(500));
      await bonus.fundBonusReward(1, parseE(500));
      await bonus.setBonusCredits(1, await pool.getAddress(), 100);

      await pool.connect(bob).triggerBonusClaim([1n]);

      expect(await pool.accBonusRewardPerShare()).to.be.gt(0);
      expect(await pool.bonusEpochClaimed(1n)).to.be.true;

      const reward = await pool.earned(alice.address);
      expect(reward).to.be.gt(0);
    });

    it("should skip already-claimed epochs gracefully", async function () {
      await pool.triggerClaim([1n]);
      const accAfterFirst = await pool.accRewardPerShare();

      // Calling again with the same epoch should not add more rewards
      await pool.triggerClaim([1n]);
      expect(await pool.accRewardPerShare()).to.equal(accAfterFirst);
    });

    it("should accumulate multiple epochs into single accRewardPerShare", async function () {
      // Fund epoch 2
      await token.mint(owner.address, parseE(2000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(2000));
      await mining.fundEpochReward(2, parseE(2000));
      await mining.setCredits(2, await pool.getAddress(), 100);

      // Claim both epochs in one call
      await pool.triggerClaim([1n, 2n]);

      // Alice gets total: 931 + 1862 = 2793
      const pending = await pool.earned(alice.address);
      expect(pending).to.equal(parseE(2793));
    });

    it("should reject triggerClaim when no active stake", async function () {
      const tx2 = await factory.createPool(operator.address, 500, TIER3, 0);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(
        (l) => l.fragment && l.fragment.name === "PoolCreated"
      );
      const pool2 = await ethers.getContractAt("BotcoinPoolV3", event2.args[0]);

      await expect(pool2.triggerClaim([1n])).to.be.revertedWith("No active stake");
    });

    it("should reject claimReward when no rewards pending", async function () {
      await expect(pool.connect(alice).claimReward()).to.be.revertedWith("No rewards");
    });

    it("should track totalUnclaimedRewards correctly", async function () {
      await pool.triggerClaim([1n]);

      // After triggerClaim, totalUnclaimedRewards = 931
      expect(await pool.totalUnclaimedRewards()).to.equal(parseE(931));

      // Alice claims
      await pool.connect(alice).claimReward();

      // After claim, totalUnclaimedRewards = 0
      expect(await pool.totalUnclaimedRewards()).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  REWARD FAIRNESS
  // ═══════════════════════════════════════════════════════════════════

  describe("Reward Fairness — accRewardPerShare distributes proportionally", function () {
    it("should distribute fairly: 75/25 split", async function () {
      await token.connect(alice).approve(await pool.getAddress(), parseE(75_000_000));
      await pool.connect(alice).deposit(parseE(75_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(25_000_000));
      await pool.connect(bob).deposit(parseE(25_000_000));

      await pool.stakeIntoMining();

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);

      const aliceReward = await pool.earned(alice.address);
      const bobReward = await pool.earned(bob.address);

      const aliceNum = Number(ethers.formatEther(aliceReward));
      const bobNum = Number(ethers.formatEther(bobReward));

      expect(aliceNum).to.be.closeTo(698.25, 0.01);
      expect(bobNum).to.be.closeTo(232.75, 0.01);
    });

    it("should not distort rewards after principal withdrawal in Finalized", async function () {
      await token.connect(alice).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(alice).deposit(parseE(50_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(50_000_000));
      await pool.connect(bob).deposit(parseE(50_000_000));

      await pool.stakeIntoMining();

      // Fund and claim epoch 1
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);
      await pool.triggerClaim([1n]);

      // Finalize
      await finalizeCycle();

      // Alice withdraws principal first (auto-claims epoch 1 rewards)
      await pool.connect(alice).withdrawShare(parseE(50_000_000));

      // Fund and claim epoch 2 (late claim — pool already Finalized)
      await token.mint(owner.address, parseE(2000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(2000));
      await mining.fundEpochReward(2, parseE(2000));
      await mining.setCredits(2, await pool.getAddress(), 100);
      await pool.triggerClaim([2n]);

      // Bob should get 50% of epoch 1 + 50% of epoch 2
      const bobReward = await pool.earned(bob.address);
      // Epoch 1 net: 931 → Bob's 50% = 465.5
      // Epoch 2 net: 1862 → Bob's 50% = 931
      // Total: 465.5 + 931 = 1396.5
      const bobNum = Number(ethers.formatEther(bobReward));
      expect(bobNum).to.be.closeTo(1396.5, 0.01);

      // Alice can still claim epoch 2 rewards via rewardDeposit
      const aliceReward = await pool.earned(alice.address);
      const aliceNum = Number(ethers.formatEther(aliceReward));
      expect(aliceNum).to.be.closeTo(931, 0.01);
    });

    it("should give O(1) gas regardless of epoch count", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund and claim 20 epochs
      for (let i = 1; i <= 20; i++) {
        await token.mint(owner.address, parseE(100));
        await token.connect(owner).approve(await mining.getAddress(), parseE(100));
        await mining.fundEpochReward(i, parseE(100));
        await mining.setCredits(i, await pool.getAddress(), 100);
      }
      const epochIds = Array.from({ length: 20 }, (_, i) => BigInt(i + 1));
      await pool.triggerClaim(epochIds);

      // claimReward gas should be constant (not growing with epoch count)
      const tx = await pool.connect(alice).claimReward();
      const receipt = await tx.wait();

      // O(1) claim — should use well under 100k gas
      expect(receipt.gasUsed).to.be.lt(100_000n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  V3: submitReceipt SELECTOR LOCK
  // ═══════════════════════════════════════════════════════════════════

  describe("Operator Integration — submitReceipt only (V3)", function () {
    beforeEach(async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
    });

    it("should expose the hardcoded SUBMIT_RECEIPT_SELECTOR", async function () {
      const selector = await pool.SUBMIT_RECEIPT_SELECTOR();
      expect(selector).to.equal("0xa7a1566f");
    });

    it("should allow operator to call submitToMining with submitReceipt selector", async function () {
      // Build a submitReceipt calldata
      const iface = new ethers.Interface([
        "function submitReceipt(uint64,uint64,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint128,uint32,bytes)"
      ]);
      const data = iface.encodeFunctionData("submitReceipt", [
        1n, 0n,
        ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash,
        ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash,
        0n, 0,
        "0x"
      ]);

      await pool.connect(operator).submitToMining(data);

      // Verify it went through (credits incremented in mock)
      const credits = await mining.credits(1n, await pool.getAddress());
      expect(credits).to.equal(1n);
    });

    it("should reject any selector that is not submitReceipt", async function () {
      const data = "0xdeadbeef";
      await expect(
        pool.connect(operator).submitToMining(data)
      ).to.be.revertedWith("Only submitReceipt allowed");
    });

    it("should reject non-operator callers", async function () {
      const iface = new ethers.Interface([
        "function submitReceipt(uint64,uint64,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint128,uint32,bytes)"
      ]);
      const data = iface.encodeFunctionData("submitReceipt", [
        1n, 0n,
        ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash,
        ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash,
        0n, 0,
        "0x"
      ]);

      await expect(
        pool.connect(alice).submitToMining(data)
      ).to.be.revertedWith("Not operator");
    });

    it("should not have setAllowedOperatorSelector (removed in V3)", async function () {
      // V3 has no selector whitelist — it's hardcoded
      expect(pool.setAllowedOperatorSelector).to.be.undefined;
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  ADMIN
  // ═══════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("should decrease fee only", async function () {
      await pool.setFee(400);
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

  // ═══════════════════════════════════════════════════════════════════
  //  EIP-1271
  // ═══════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════
  //  MULTI-USER SCENARIO
  // ═══════════════════════════════════════════════════════════════════

  describe("Multi-user Scenario", function () {
    it("should distribute rewards proportionally", async function () {
      await token.connect(alice).approve(await pool.getAddress(), parseE(75_000_000));
      await pool.connect(alice).deposit(parseE(75_000_000));

      await token.connect(bob).approve(await pool.getAddress(), parseE(25_000_000));
      await pool.connect(bob).deposit(parseE(25_000_000));

      await pool.stakeIntoMining();

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);

      const aliceReward = await pool.earned(alice.address);
      const bobReward = await pool.earned(bob.address);

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

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);
      await finalizeCycle();

      const aliceBefore = await token.balanceOf(alice.address);
      await pool.connect(alice).withdrawShare(parseE(50_000_000));
      const aliceAfter = await token.balanceOf(alice.address);

      // Principal (50M) + 50% of 931 = 50_000_465.5
      const aliceGot = Number(ethers.formatEther(aliceAfter - aliceBefore));
      expect(aliceGot).to.be.closeTo(50_000_465.5, 0.01);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  V3: RESCUE TOKENS
  // ═══════════════════════════════════════════════════════════════════

  describe("Rescue Tokens (V3)", function () {
    it("should rescue accidentally sent staking tokens (surplus only)", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      // Someone accidentally sends 1000 tokens via raw transfer
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).transfer(await pool.getAddress(), parseE(1000));

      // Owner rescues the surplus
      const ownerBefore = await token.balanceOf(owner.address);
      await pool.rescueTokens(await token.getAddress(), owner.address, parseE(1000));
      const ownerAfter = await token.balanceOf(owner.address);

      expect(ownerAfter - ownerBefore).to.equal(parseE(1000));
    });

    it("should not allow rescuing deposited funds", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      // Trying to rescue deposited funds
      await expect(
        pool.rescueTokens(await token.getAddress(), owner.address, TIER1)
      ).to.be.revertedWith("Exceeds surplus");
    });

    it("should not allow rescuing unclaimed rewards", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund and claim rewards
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);
      await pool.triggerClaim([1n]);

      // Finalize to get principal back in pool
      await finalizeCycle();

      // Pool balance = 25M principal + 931 unclaimed rewards
      // totalDeposits = 25M, totalUnclaimedRewards = 931
      // Surplus = 0, so cannot rescue anything
      await expect(
        pool.rescueTokens(await token.getAddress(), owner.address, parseE(1))
      ).to.be.revertedWith("Exceeds surplus");
    });

    it("should rescue non-staking ERC-20 tokens entirely", async function () {
      // Deploy a different token
      const Token2 = await ethers.getContractFactory("MockERC20");
      const token2 = await Token2.deploy();

      // Accidentally send token2 to pool
      await token2.mint(owner.address, parseE(5000));
      await token2.connect(owner).transfer(await pool.getAddress(), parseE(5000));

      await pool.rescueTokens(await token2.getAddress(), owner.address, 0); // 0 = max available
      expect(await token2.balanceOf(await pool.getAddress())).to.equal(0);
    });

    it("should reject rescue with zero recipient", async function () {
      await expect(
        pool.rescueTokens(await token.getAddress(), ethers.ZeroAddress, parseE(1))
      ).to.be.revertedWith("Zero recipient");
    });

    it("should reject non-owner rescue", async function () {
      await expect(
        pool.connect(alice).rescueTokens(await token.getAddress(), alice.address, parseE(1))
      ).to.be.reverted;
    });

    it("should rescue surplus even when pool has unclaimed rewards", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      // Fund and claim rewards
      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);
      await pool.triggerClaim([1n]);

      await finalizeCycle();

      // Now accidentally send 500 extra tokens
      await token.mint(owner.address, parseE(500));
      await token.connect(owner).transfer(await pool.getAddress(), parseE(500));

      // Can rescue exactly the 500 surplus
      await pool.rescueTokens(await token.getAddress(), owner.address, parseE(500));

      // But can't rescue the committed funds
      await expect(
        pool.rescueTokens(await token.getAddress(), owner.address, parseE(1))
      ).to.be.revertedWith("Exceeds surplus");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  VIEW HELPERS
  // ═══════════════════════════════════════════════════════════════════

  describe("View Helpers", function () {
    it("should return correct pool info", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      const info = await pool.getPoolInfo();
      expect(info[0]).to.equal(1); // Active state
      expect(info[1]).to.equal(TIER1); // stakedInMining
      expect(info[3]).to.equal(TIER1); // activeStake
      expect(info[5]).to.be.true; // eligible
      expect(info[7]).to.equal(0); // 0 unclaimed rewards
    });

    it("should track unclaimedRewards in poolInfo", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();

      await token.mint(owner.address, parseE(1000));
      await token.connect(owner).approve(await mining.getAddress(), parseE(1000));
      await mining.fundEpochReward(1, parseE(1000));
      await mining.setCredits(1, await pool.getAddress(), 100);

      await pool.triggerClaim([1n]);

      const info = await pool.getPoolInfo();
      expect(info[7]).to.equal(parseE(931)); // totalUnclaimedRewards
    });

    it("should return correct user info", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);

      const info = await pool.getUserInfo(alice.address);
      expect(info[0]).to.equal(TIER1); // depositAmt
      expect(info[2]).to.equal(10000n); // 100% share
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

  // ═══════════════════════════════════════════════════════════════════
  //  SAFETY GUARDS
  // ═══════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════
  //  SINGLE-USE INVARIANT
  // ═══════════════════════════════════════════════════════════════════

  describe("Single-Use Invariant", function () {
    it("should not allow re-staking after Finalize", async function () {
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining();
      await finalizeCycle();

      expect(await pool.poolState()).to.equal(3);
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

      await pool.connect(alice).withdrawShare(TIER1);

      const aliceAfter = await token.balanceOf(alice.address);
      const received = aliceAfter - aliceBefore;

      expect(received).to.be.gt(TIER1);
      expect(Number(ethers.formatEther(received))).to.be.closeTo(25_000_931, 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  MIN ACTIVE EPOCHS
  // ═══════════════════════════════════════════════════════════════════

  describe("Min Active Epochs", function () {

    it("should reject minActiveEpochs > 10", async function () {
      await expect(
        factory.createPool(operator.address, 500, TIER3, 11)
      ).to.be.revertedWith("Min epochs too high");
    });

    it("should allow minActiveEpochs = 0 (immediate unstake)", async function () {
      // Default pool already has minActiveEpochs=0
      await token.connect(alice).approve(await pool.getAddress(), TIER1);
      await pool.connect(alice).deposit(TIER1);
      await pool.stakeIntoMining(); // epoch 1

      // Should succeed immediately even in epoch 1
      await pool.requestUnstake();
    });

    it("should allow minActiveEpochs = 10 (max)", async function () {
      const tx = await factory.createPool(operator.address, 500, TIER3, 10);
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment && l.fragment.name === "PoolCreated");
      const p = await ethers.getContractAt("BotcoinPoolV3", ev.args[0]);

      expect(await p.minActiveEpochs()).to.equal(10);
    });

    it("should block requestUnstake before min epochs reached", async function () {
      const tx = await factory.createPool(operator.address, 500, TIER3, 3);
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment && l.fragment.name === "PoolCreated");
      const p = await ethers.getContractAt("BotcoinPoolV3", ev.args[0]);

      await token.connect(alice).approve(await p.getAddress(), TIER1);
      await p.connect(alice).deposit(TIER1);

      await mining.setEpoch(5);
      await p.stakeIntoMining(); // stakeEpoch = 5

      // epoch 5: need 5+3=8, revert at 5
      await expect(p.requestUnstake()).to.be.revertedWith("Min active epochs not reached");

      // epoch 7: still too early (need >= 8)
      await mining.setEpoch(7);
      await expect(p.requestUnstake()).to.be.revertedWith("Min active epochs not reached");

      // epoch 8: exactly stakeEpoch + minActiveEpochs → should pass
      await mining.setEpoch(8);
      await p.requestUnstake(); // should succeed
    });

    it("should expose minActiveEpochs and stakeEpoch in getPoolInfo", async function () {
      const tx = await factory.createPool(operator.address, 500, TIER3, 5);
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment && l.fragment.name === "PoolCreated");
      const p = await ethers.getContractAt("BotcoinPoolV3", ev.args[0]);

      let info = await p.getPoolInfo();
      expect(info[8]).to.equal(5);  // minEpochs
      expect(info[9]).to.equal(0);  // stakedAtEpoch (not staked yet)

      await token.connect(alice).approve(await p.getAddress(), TIER1);
      await p.connect(alice).deposit(TIER1);

      await mining.setEpoch(3);
      await p.stakeIntoMining();

      info = await p.getPoolInfo();
      expect(info[8]).to.equal(5);  // minEpochs (immutable)
      expect(info[9]).to.equal(3);  // stakedAtEpoch = 3
    });

    it("should include minActiveEpochs in PoolCreated event", async function () {
      const tx = await factory.createPool(operator.address, 500, TIER3, 7);
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment && l.fragment.name === "PoolCreated");
      expect(ev.args.minActiveEpochs).to.equal(7);
    });
  });
});
