import hre from "hardhat";
import "dotenv/config";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying BotcoinPoolFactoryV3 with account:", deployer.address);

  // Known Base Mainnet addresses (public, not secrets)
  const BASE_BOTCOIN     = "0xA601877977340862Ca67f816eb079958E5bd0BA3";
  const BASE_MINING      = "0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716";
  const BASE_BONUS_EPOCH = "0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8";

  const networkName = hre.network.name;

  const botcoinAddress    = process.env.BOTCOIN_ADDRESS     || (networkName === "base" ? BASE_BOTCOIN : undefined);
  const miningAddress     = process.env.MINING_ADDRESS      || (networkName === "base" ? BASE_MINING : undefined);
  const bonusEpochAddress = process.env.BONUS_EPOCH_ADDRESS || (networkName === "base" ? BASE_BONUS_EPOCH : undefined);

  if (!botcoinAddress || !miningAddress || !bonusEpochAddress) {
    throw new Error("Set BOTCOIN_ADDRESS, MINING_ADDRESS, and BONUS_EPOCH_ADDRESS for this network.");
  }

  // Protocol fee: 1% (100 bps) sent to the deployer
  const protocolFeeBps = 100;
  const protocolFeeRecipient = deployer.address;

  console.log(`  Token:       ${botcoinAddress}`);
  console.log(`  Mining:      ${miningAddress}`);
  console.log(`  BonusEpoch:  ${bonusEpochAddress}`);
  console.log(`  Protocol fee: ${protocolFeeBps} bps (${protocolFeeBps / 100}%) → ${protocolFeeRecipient}`);

  const Factory = await hre.ethers.getContractFactory("BotcoinPoolFactoryV3");
  const factory = await Factory.deploy(
    botcoinAddress,
    miningAddress,
    bonusEpochAddress,
    protocolFeeRecipient,
    protocolFeeBps
  );

  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  console.log("\n✅ BotcoinPoolFactoryV3 deployed to:", factoryAddr);

  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nTo verify on BaseScan:");
    console.log(`npx hardhat verify --network ${networkName} ${factoryAddr} ${botcoinAddress} ${miningAddress} ${bonusEpochAddress} ${protocolFeeRecipient} ${protocolFeeBps}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
