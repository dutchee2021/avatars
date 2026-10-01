// The Card Wall configuration: collections, chain access, and outbound links.

export const COLLECTIONS = Object.freeze({
  stonkbrokers: Object.freeze({
    id: 'stonkbrokers',
    menuLabel: 'STONKBROKERS', // bottom collection bar + dropdown
    titleName: 'STONKBROKER', // title line: STONKBROKER #4354
    labelName: '$STONKBROKER', // slab label, second line
    contract: '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0',
    minId: 1,
    maxId: 4444,
  }),
  interns: Object.freeze({
    id: 'interns',
    menuLabel: 'THE INTERNS',
    titleName: 'INTERN',
    labelName: '$STONKBROKER INTERNS',
    contract: '0xfc4b0c4f464dc3037cf013934648a8a726d565a5',
    minId: 1,
    maxId: 8888,
  }),
});

export const COLLECTION_ORDER = ['stonkbrokers', 'interns'];
export const DEFAULT_COLLECTION = 'stonkbrokers';
export const DEFAULT_TOKEN_ID = 4354; // the collections' mascot

// Optional host overrides, set on window before the app loads. Production
// sets none; the claude.ai review build uses them because its sandbox has
// no network access and passes no query string to the page.
const HOST = globalThis.CARDWALL_HOST || {};
export const PREVIEW = HOST.preview === true;

// Token art is rendered onchain. The page first asks the same-origin art
// endpoint (the Cloudflare Worker in /worker), then reads tokenURI()
// straight from Robinhood Chain (chain ID 4663).
export const ART_ENDPOINT = HOST.artEndpoint ?? './api/art/';
export const RPC_URLS = Object.freeze(HOST.rpcUrls ?? ['https://rpc.mainnet.chain.robinhood.com']);
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

export const SITE_NAME = 'THECARDWALL.COM';
export const CLAW_MACHINE_URL = 'https://thecardwall.com/alley';
export const PRIVACY_URL = 'https://moxapp.io/privacy';
// Canonical public location, used for share links and the desktop QR code
// when the page runs somewhere that cannot be linked to directly.
export const CANONICAL_URL = HOST.canonicalUrl ?? 'https://moxapp.io/thecardwall/';

export function openseaUrl(collection, tokenId) {
  return `https://opensea.io/item/robinhood/${collection.contract}/${tokenId}`;
}

export function displayName(collection, tokenId) {
  return `${collection.titleName} #${tokenId}`;
}
