const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BotcoinPool Integration", function () {
    let BotcoinPoolContract, pool;
    let MockERC20Contract, token;
    let MockMiningContract, mining;
    let owner, operator, user1;
    const FEE_BPS = 500; // 5%
    const AMOUNT = ethers.parseEther("1000");

    beforeEach(async function () {
        [owner, operator, user1] = await ethers.getSigners();

        // 1. Deploy Mocks
        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        token = await MockTokenFactory.deploy();
        await token.waitForDeployment();
        
        // 2. Mock Mining Contract
        // We'll deploy a simple contract that holds the `currentEpoch` state
        // and a dummy `claim` function.
        const MockMiningFactory = await ethers.getContractFactory("MockMiningContract");
        mining = await MockMiningFactory.deploy();
        await mining.waitForDeployment();

        // 3. Deploy Pool
        const PoolFactory = await ethers.getContractFactory("BotcoinPool");
        pool = await PoolFactory.deploy(
            await token.getAddress(),
            await mining.getAddress(),
            operator.address,
            FEE_BPS,
            owner.address,   // protocolFeeRecipient
            100,              // protocolFeeBps = 1%
            ethers.parseEther("75000000") // maxStake = 75M
        );
        await pool.waitForDeployment();

        // Setup Balances
        await token.mint(user1.address, AMOUNT * 10n);
        await token.connect(user1).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    it("1. Users start with 0 stake", async function () {
        const activeStake = await pool.userActiveStake(user1.address);
        expect(activeStake).to.equal(0n);
        const pendingStake = await pool.userPendingStake(user1.address);
        expect(pendingStake).to.equal(0n);
    });

    it("2. EIP-1271 Signature is valid for Operator", async function () {
        const message = "Challenge Nonce";
        // EIP-191 Hash
        const hash = ethers.hashMessage(message);

        // Operator signs
        const signature = await operator.signMessage(message);

        // Pool verifies
        const magicValue = await pool.isValidSignature(hash, signature);
        expect(magicValue).to.equal("0x1626ba7e");

        // Non-operator fails
        const badSig = await user1.signMessage(message);
        const badMagic = await pool.isValidSignature(hash, badSig);
        expect(badMagic).to.not.equal("0x1626ba7e");
    });

    it("3. Deposit creates pending stake in same epoch", async function () {
        // Epoch 0
        await pool.connect(user1).deposit(AMOUNT);

        // Active stake should be 0
        expect(await pool.userActiveStake(user1.address)).to.equal(0n);
        // Pending stake should be AMOUNT
        expect(await pool.userPendingStake(user1.address)).to.equal(AMOUNT);

        // Advance Epoch on Mock Mining
        await mining.setEpoch(1);

        // Trigger interaction (another deposit or any state changing call) to transition state
        // Or simply call a view? No, view doesn't change state.
        // We need to call `deposit` or `withdraw` or `claimReward` to update user state.
        // Let's try withdrawing 0 (which might revert) or making a small deposit.
        // Or just `claimReward` (even if 0).
        await pool.connect(user1).claimReward();

        // Now pending should be active
        expect(await pool.userActiveStake(user1.address)).to.equal(AMOUNT);
        expect(await pool.userPendingStake(user1.address)).to.equal(0n);
    });
});
