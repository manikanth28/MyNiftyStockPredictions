import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  DEFAULT_STARTING_CASH,
  buyWalletPosition,
  createDefaultWallet,
  isPortfolioWallet,
  sellWalletPosition
} from "@/lib/portfolio-wallet";
import type {
  BuyPositionInput,
  PortfolioWallet,
  SellPositionOptions,
  WalletTradeExitReason
} from "@/lib/portfolio-wallet";

const DATA_DIRECTORY_CANDIDATES = [
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "..", "..", "data")
];
const SAMPLE_FILE_NAME = "sample-recommendations.json";
const WALLET_DIRECTORY_NAME = "wallet";
const WALLET_FILE_NAME = "paper-wallet.json";

let walletQueue: Promise<void> = Promise.resolve();

async function findFirstReadableFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function resolvedDataDirectory() {
  const samplePath = await findFirstReadableFile(
    DATA_DIRECTORY_CANDIDATES.map((directory) => path.join(directory, SAMPLE_FILE_NAME))
  );
  const directory = samplePath ? path.dirname(samplePath) : DATA_DIRECTORY_CANDIDATES[0];

  await mkdir(directory, { recursive: true });
  return directory;
}

export async function getSharedDataDirectory() {
  return resolvedDataDirectory();
}

async function walletDirectoryPath() {
  const directory = path.join(await resolvedDataDirectory(), WALLET_DIRECTORY_NAME);

  await mkdir(directory, { recursive: true });
  return directory;
}

async function walletFilePath() {
  return path.join(await walletDirectoryPath(), WALLET_FILE_NAME);
}

async function withWalletLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = walletQueue;
  let release!: () => void;

  walletQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
  }
}

async function readWalletFile() {
  try {
    const payload = JSON.parse(await readFile(await walletFilePath(), "utf-8"));
    return isPortfolioWallet(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function writeWalletFile(wallet: PortfolioWallet) {
  const filePath = await walletFilePath();
  const temporaryPath = `${filePath}.tmp`;

  await writeFile(temporaryPath, JSON.stringify(wallet, null, 2), "utf-8");
  await rename(temporaryPath, filePath);
  return wallet;
}

export async function readSharedWallet() {
  return withWalletLock(async () => {
    const wallet = await readWalletFile();

    if (wallet) {
      return wallet;
    }

    return writeWalletFile(createDefaultWallet(DEFAULT_STARTING_CASH));
  });
}

export async function replaceSharedWallet(wallet: PortfolioWallet) {
  return withWalletLock(async () => writeWalletFile(wallet));
}

export async function resetSharedWallet(startingCash = DEFAULT_STARTING_CASH) {
  return replaceSharedWallet(createDefaultWallet(startingCash));
}

export async function buySharedWalletPosition(input: BuyPositionInput) {
  return withWalletLock(async () => {
    const wallet = (await readWalletFile()) ?? createDefaultWallet(DEFAULT_STARTING_CASH);
    return writeWalletFile(buyWalletPosition(wallet, input));
  });
}

export async function sellSharedWalletPosition(
  positionId: string,
  exitPrice: number,
  exitReason: WalletTradeExitReason,
  options: SellPositionOptions = {}
) {
  return withWalletLock(async () => {
    const wallet = (await readWalletFile()) ?? createDefaultWallet(DEFAULT_STARTING_CASH);
    return writeWalletFile(sellWalletPosition(wallet, positionId, exitPrice, exitReason, options));
  });
}
