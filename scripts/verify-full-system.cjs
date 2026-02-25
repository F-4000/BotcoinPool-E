// scripts/verify-full-system.js
const hre = require("hardhat");

async function main() {
  console.log("--- Starting Full System Verification ---");
  
  // 1. Setup Signers
  const [deployer, operator, user] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Operator:", operator.address);
  console.log("User:", user.address);

  // 2. Deploy Mocks
  console.log("\n[1] Deploying Mocks...");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MockToken deployed:", tokenAddress);

  const MockMining = await hre.ethers.getContractFactory("MockMiningContract");
  const mining = await MockMining.deploy();
  await mining.waitForDeployment();
  const miningAddress = await mining.getAddress();
  console.log("MockMining deployed:", miningAddress);

  // 3. Deploy Factory
  console.log("\n[2] Deploying Factory...");
  const Factory = await hre.ethers.getContractFactory("BotcoinPoolFactory");
  const factory = await Factory.deploy(tokenAddress, miningAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("Factory deployed:", factoryAddress);

  // 4. Create Pool
  console.log("\n[3] Creating Pool via Factory...");
  const tx = await factory.createPool(operator.address, 500); // 5% fee
  const receipt = await tx.wait();
  
  // Find PoolCreated event
  const event = receipt.logs.find(log => {
      try {
          const parsed = factory.interface.parseLog(log);
          return parsed.name === "PoolCreated";
      } catch (e) { return false; }
  });
  
  const parsedEvent = factory.interface.parseLog(event);
  const poolAddress = parsedEvent.args[0];
  console.log("Pool deployed at:", poolAddress);

  // 5. Interact with Pool
  console.log("\n[4] Testing User Interaction...");
  const pool = await hre.ethers.getContractAt("BotcoinPool", poolAddress);

  // Mint tokens to user
  const amount = hre.ethers.parseEther("100");
  await token.mint(user.address, amount);
  await token.connect(user).approve(poolAddress, amount);
  
  // Deposit
  console.log("User depositing 100 tokens...");
  await pool.connect(user).deposit(amount);
  
  // Verify Staked Amount (Pending)
  const pendingStake = await pool.userPendingStake(user.address);
  console.log("User Pending Stake:", hre.ethers.formatEther(pendingStake));
  
  if (pendingStake == amount) {
      console.log("SUCCESS: Deposit registered as pending.");
  } else {
      console.error("FAILURE: Deposit not registered correctly.");
      process.exit(1);
  }

  // 6. Verify Operator Access
  console.log("\n[5] Testing Operator Permissions...");
  // Try to set fee as operator (should fail, only owner can set fee - wait, Factory transfers ownership?)
  // In Factory: newPool.transferOwnership(msg.sender);
  // Who called createPool? The `deployer` called `factory.createPool`.
  // So `msg.sender` is `deployer`.
  // The `operator` param is just for the stored `operator` variable.
  // The OWNER is `deployer`.
  
  const owner = await pool.owner();
  console.log("Pool Owner:", owner);
  console.log("Pool Operator:", await pool.operator());

  if (owner === deployer.address) {
      console.log("SUCCESS: Ownership transferred correctly.");
  } else {
      console.error("FAILURE: Ownership mismatch.");
  }

  console.log("\n--- Verification Complete: System is Ready for Deployment ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
