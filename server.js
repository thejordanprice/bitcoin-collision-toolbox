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

// Function to generate a P2PKH Bitcoin address and its WIF key (both compressed and uncompressed)
function generateBitcoinAddress() {
    const keyPairCompressed = ECPair.makeRandom();
    const { address: addressCompressed } = payments.p2pkh({ pubkey: keyPairCompressed.publicKey });
    const wifKeyCompressed = keyPairCompressed.toWIF();

    const keyPairUncompressed = ECPair.makeRandom({ compressed: false });
    const { address: addressUncompressed } = payments.p2pkh({ pubkey: keyPairUncompressed.publicKey });
    const wifKeyUncompressed = keyPairUncompressed.toWIF();

    return { addressCompressed, wifKeyCompressed, addressUncompressed, wifKeyUncompressed };
}

// Function to check if an address exists in the MongoDB collection
async function checkAddressInDB(address) {
    // address = "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo" // Test address
    if (!collection) {
        return null;
    }

    try {
        // Search for the address in MongoDB
        const result = await collection.findOne({ _id: address });
        return result; // Return the result if found, or null if not
    } catch (err) {
        console.error('Error querying MongoDB:', err);
        return null;
    }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        const command = JSON.parse(message);
        if (command.action === 'start') {
            if (!generating) {
                generating = true;
                totalCount = 0;
                const startTime = Date.now();

                // Start generating keys in an interval
                const interval = setInterval(async () => {
                    if (!generating) {
                        clearInterval(interval);
                        return;
                    }

                    // Generate a new Bitcoin address and WIF key
                    const { addressCompressed, wifKeyCompressed, addressUncompressed, wifKeyUncompressed } = generateBitcoinAddress();
                    totalCount++;

                    // Check if the compressed address exists in the MongoDB database
                    const existingCompressedAddress = await checkAddressInDB(addressCompressed);
                    const existingUncompressedAddress = await checkAddressInDB(addressUncompressed);

                    // If the compressed address exists, display the saved balance and details
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
                        // If the compressed address doesn't exist, display only the generated key and address
                        ws.send(JSON.stringify({
                            action: 'generated',
                            address: addressCompressed,
                            wifKey: wifKeyCompressed,
                            totalCount,
                        }));
                    }

                    // Handle uncompressed address similarly
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
                }, 0);
            }
        } else if (command.action === 'stop') {
            generating = false;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        generating = false; // Stop generation when client disconnects
    });
});

// Start the server on port 8080
server.listen(8080, () => {
    console.log('Server is running on http://localhost:8080');
});
