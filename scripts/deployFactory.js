import hre from "hardhat";
import "dotenv/config";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying BotcoinPoolFactory with the account:", deployer.address);

  // Known Base Mainnet addresses (public, not secrets)
  const BASE_BOTCOIN   = "0xA601877977340862Ca67f816eb079958E5bd0BA3";
  const BASE_MINING    = "0xd572e61e1B627d4105832C815Ccd722B5baD9233";

  const networkName = hre.network.name;
  let botcoinAddress = process.env.BOTCOIN_ADDRESS || (networkName === "base" ? BASE_BOTCOIN : undefined);
  let miningContractAddress = process.env.MINING_CONTRACT_ADDRESS || (networkName === "base" ? BASE_MINING : undefined);

  // On local networks, deploy mocks if addresses are not provided
  if (networkName === "hardhat" || networkName === "localhost") {
    if (!botcoinAddress) {
      console.log("Local network detected and no BOTCOIN_ADDRESS env var found. Deploying MockERC20...");
      const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
      const mockToken = await MockERC20.deploy();
      await mockToken.waitForDeployment();
      botcoinAddress = await mockToken.getAddress();
      console.log("MockERC20 deployed to:", botcoinAddress);
    }
    
    if (!miningContractAddress) {
      console.log("Local network detected and no MINING_CONTRACT_ADDRESS env var found. Deploying MockMiningContract...");
      const MockMining = await hre.ethers.getContractFactory("MockMiningContract");
      const mockMining = await MockMining.deploy();
      await mockMining.waitForDeployment();
      miningContractAddress = await mockMining.getAddress();
      console.log("MockMiningContract deployed to:", miningContractAddress);
    }
  }

  if (!botcoinAddress || !miningContractAddress) {
    throw new Error("Please set BOTCOIN_ADDRESS and MINING_CONTRACT_ADDRESS in your environment variables for this network.");
  }

  // Protocol fee: 1% (100 bps) sent to the deployer's address
  const protocolFeeBps = 100;
  const protocolFeeRecipient = deployer.address;

  console.log(`Deploying Factory with Token: ${botcoinAddress} and Mining: ${miningContractAddress}`);
  console.log(`Protocol fee: ${protocolFeeBps} bps (${protocolFeeBps / 100}%) to ${protocolFeeRecipient}`);

  const BotcoinPoolFactory = await hre.ethers.getContractFactory("BotcoinPoolFactory");
  const factory = await BotcoinPoolFactory.deploy(botcoinAddress, miningContractAddress, protocolFeeRecipient, protocolFeeBps);

  await factory.waitForDeployment();

  console.log("BotcoinPoolFactory deployed to:", await factory.getAddress());
  
  // Verification instructions
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nTo verify on Basescan:");
    console.log(`npx hardhat verify --network ${networkName} ${await factory.getAddress()} ${botcoinAddress} ${miningContractAddress} ${protocolFeeRecipient} ${protocolFeeBps}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
