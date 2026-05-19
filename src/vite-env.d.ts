/// <reference types="vite/client" />

interface ImportMetaEnv {
  // SURI for the faucet that funds new burner wallets on first use.
  // Default is //Alice (works on a local revive dev node). On public
  // testnets like Paseo Asset Hub, set this in .env.local to the
  // mnemonic of an account you've funded — see .env.example.
  readonly VITE_FAUCET_SURI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
