const http = require('http');
const WebSocket = require('ws');
const { ECPair, payments } = require('bitcoinjs-lib');
const MongoClient = require('mongodb').MongoClient;

// MongoDB connection URL and database information
const url = 'mongodb://localhost:27017';
const dbName = 'bitcoin';
const collectionName = 'addresses';

let db;
let collection;

// Connect to MongoDB
MongoClient.connect(url)
    .then((client) => {
        console.log('Connected to MongoDB');
        db = client.db(dbName);
        collection = db.collection(collectionName);
    })
    .catch((err) => console.error('Failed to connect to MongoDB:', err));

// Create a simple HTTP server to serve the HTML file
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(require('fs').readFileSync('index.html'));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Create a WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

let generating = false;
let totalCount = 0;

// Function to generate Bitcoin addresses
function generateBitcoinAddresses() {
    // Generate a single key pair
    const keyPair = ECPair.makeRandom();

    // Derive compressed address and WIF
    const { address: addressCompressed } = payments.p2pkh({ pubkey: keyPair.publicKey });
    const wifKeyCompressed = keyPair.toWIF();

    // Derive uncompressed address and WIF
    const keyPairUncompressed = ECPair.fromPrivateKey(keyPair.privateKey, { compressed: false });
    const { address: addressUncompressed } = payments.p2pkh({ pubkey: keyPairUncompressed.publicKey });
    const wifKeyUncompressed = keyPairUncompressed.toWIF();

    // Derive Bech32 address
    const { address: addressBech32 } = payments.p2wpkh({ pubkey: keyPair.publicKey });

    // Return all addresses, WIFs, and keyPair for Bech32
    return {
        keyPair,
        addressCompressed,
        wifKeyCompressed,
        addressUncompressed,
        wifKeyUncompressed,
        addressBech32,
    };
}

// Function to check if an address exists in the MongoDB collection
async function checkAddressInDB(address) {
    // address = "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo";
    if (!collection) {
        return null;
    }

    try {
        const result = await collection.findOne({ _id: address });
        return result; // Return the result if found, or null if not
    } catch (err) {
        console.error('Error querying MongoDB:', err);
        return null;
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        const command = JSON.parse(message);
        if (command.action === 'start') {
            if (!generating) {
                generating = true;
                totalCount = 0;

                // Start generating keys in an interval
                const interval = setInterval(async () => {
                    if (!generating) {
                        clearInterval(interval);
                        return;
                    }

                    // Generate Bitcoin addresses and their WIF keys
                    const {
                        keyPair,
                        addressCompressed,
                        wifKeyCompressed,
                        addressUncompressed,
                        wifKeyUncompressed,
                        addressBech32
                    } = generateBitcoinAddresses();
                    totalCount++;

                    // Check all addresses against the database
                    const existingCompressedAddress = await checkAddressInDB(addressCompressed);
                    const existingUncompressedAddress = await checkAddressInDB(addressUncompressed);
                    const existingBech32Address = await checkAddressInDB(addressBech32);

                    // Handle results for compressed address
                    if (existingCompressedAddress) {
                        const { balance } = existingCompressedAddress;
                        ws.send(JSON.stringify({
                            action: 'found',
                            address: addressCompressed,
                            wifKey: wifKeyCompressed,
                            balance,
                            totalCount,
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            action: 'generated',
                            address: addressCompressed,
                            wifKey: wifKeyCompressed,
                            totalCount,
                        }));
                    }

                    // Handle results for uncompressed address
                    if (existingUncompressedAddress) {
                        const { balance } = existingUncompressedAddress;
                        ws.send(JSON.stringify({
                            action: 'found',
                            address: addressUncompressed,
                            wifKey: wifKeyUncompressed,
                            balance,
                            totalCount,
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            action: 'generated',
                            address: addressUncompressed,
                            wifKey: wifKeyUncompressed,
                            totalCount,
                        }));
                    }

                    // Handle results for Bech32 address
                    if (existingBech32Address) {
                        const { balance } = existingBech32Address;
                        ws.send(JSON.stringify({
                            action: 'found',
                            address: addressBech32,
                            wifKey: keyPair.toWIF(),
                            balance,
                            totalCount,
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            action: 'generated',
                            address: addressBech32,
                            wifKey: keyPair.toWIF(),
                            totalCount,
                        }));
                    }
                }, 0);
            }
        } else if (command.action === 'stop') {
            generating = false;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        generating = false;
    });
});

// Start the server on port 8080
server.listen(8080, () => {
    console.log('Server is running on http://localhost:8080');
});
