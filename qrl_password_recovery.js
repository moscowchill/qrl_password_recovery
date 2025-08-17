#!/usr/bin/env node

const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

if (isMainThread) {
    // Main thread - coordinates workers
    const numCPUs = os.cpus().length;
    console.log(`QRL Wallet Low-Memory Password Recovery`);
    console.log(`Using ${numCPUs} CPU cores`);
    console.log('===========================================');
    
    const args = process.argv.slice(2);
    let walletFile = 'wallet.json';
    let wordlistFile = 'weakpass_4.txt';
    
    // Parse arguments
    const walletIndex = args.indexOf('--wallet');
    if (walletIndex !== -1 && walletIndex + 1 < args.length) {
        walletFile = args[walletIndex + 1];
    }
    
    const wordlistIndex = args.indexOf('--wordlist');
    if (wordlistIndex !== -1 && wordlistIndex + 1 < args.length) {
        wordlistFile = args[wordlistIndex + 1];
    }
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log('Usage: node low_memory_recovery.js [options]');
        console.log('Options:');
        console.log('  --wallet <file>     Wallet file (default: wallet.json)');
        console.log('  --wordlist <file>   Wordlist file (default: weakpass_4.txt)');
        console.log('  --threads <num>     Number of threads (default: CPU cores)');
        console.log('  --chunk-size <num>  Chunk size in bytes (default: 8192)');
        process.exit(0);
    }
    
    // Allow custom thread count and chunk size
    let threadCount = numCPUs;
    let chunkSize = 8192; // 8KB chunks
    
    const threadsIndex = args.indexOf('--threads');
    if (threadsIndex !== -1 && threadsIndex + 1 < args.length) {
        threadCount = parseInt(args[threadsIndex + 1]) || numCPUs;
    }
    
    const chunkIndex = args.indexOf('--chunk-size');
    if (chunkIndex !== -1 && chunkIndex + 1 < args.length) {
        chunkSize = parseInt(args[chunkIndex + 1]) || 8192;
    }
    
    // Load wallet
    let walletData;
    try {
        walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
        console.log('✓ Wallet loaded');
    } catch (error) {
        console.error('✗ Error loading wallet:', error.message);
        process.exit(1);
    }
    
    console.log(`✓ Starting ${threadCount} workers with ${chunkSize} byte chunks`);
    
    const workers = [];
    let totalTested = 0;
    let found = false;
    let filePosition = 0;
    let fileHandle;
    let waitingWorkers = [];
    let buffer = '';
    let eof = false;
    let totalFileSize = 0;
    
    async function initializeFile() {
        try {
            fileHandle = await fs.promises.open(wordlistFile, 'r');
            const stats = await fileHandle.stat();
            totalFileSize = stats.size;
            console.log(`✓ File opened for streaming (${(totalFileSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        } catch (error) {
            console.error('✗ Error opening wordlist:', error.message);
            process.exit(1);
        }
    }
    
    async function readNextChunk() {
        if (eof) return [];
        
        try {
            const chunk = Buffer.alloc(chunkSize);
            const { bytesRead } = await fileHandle.read(chunk, 0, chunkSize, filePosition);
            
            if (bytesRead === 0) {
                eof = true;
                console.log('✓ Reached end of file');
                return buffer.length > 0 ? [buffer.trim()].filter(p => p.length > 0) : [];
            }
            
            filePosition += bytesRead;
            const chunkText = chunk.subarray(0, bytesRead).toString('utf8');
            buffer += chunkText;
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            const passwords = lines
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
                
            return passwords;
            
        } catch (error) {
            console.error('Error reading file:', error.message);
            eof = true;
            return [];
        }
    }
    
    async function sendPasswordsToWorker() {
        if (waitingWorkers.length === 0) return;
        
        try {
            const passwords = await readNextChunk();
            
            if (passwords.length > 0) {
                const worker = waitingWorkers.shift();
                if (worker && !worker.killed) {
                    worker.postMessage({ type: 'passwords', passwords });
                }
            } else if (eof) {
                // Send done signal to all waiting workers
                console.log(`✓ Signaling completion to ${waitingWorkers.length} waiting workers`);
                while (waitingWorkers.length > 0) {
                    const worker = waitingWorkers.shift();
                    if (worker && !worker.killed) {
                        worker.postMessage({ type: 'done' });
                    }
                }
            } else {
                // No passwords available but not EOF yet, try again shortly
                setTimeout(() => sendPasswordsToWorker(), 100);
            }
        } catch (error) {
            console.error('Error in sendPasswordsToWorker:', error.message);
        }
    }
    
    function cleanup() {
        if (fileHandle) {
            fileHandle.close().catch(console.error);
        }
        workers.forEach(worker => {
            if (!worker.killed) {
                worker.terminate();
            }
        });
    }
    
    // Progress reporting
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
        if (!found) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = Math.round(totalTested / elapsed);
            const progressPercent = totalFileSize > 0 ? ((filePosition / totalFileSize) * 100).toFixed(2) : 0;
            const progressGB = (filePosition / 1024 / 1024 / 1024).toFixed(2);
            const totalGB = (totalFileSize / 1024 / 1024 / 1024).toFixed(2);
            
            // Format elapsed time
            const hours = Math.floor(elapsed / 3600);
            const minutes = Math.floor((elapsed % 3600) / 60);
            const seconds = Math.floor(elapsed % 60);
            const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            console.log(`Progress: ${progressPercent}% (${progressGB}/${totalGB} GB) | ${totalTested.toLocaleString()} passwords at ${rate.toLocaleString()}/sec | Runtime: ${timeStr}`);
        } else {
            clearInterval(progressInterval);
        }
    }, 10000);
    
    // Create workers
    for (let i = 0; i < threadCount; i++) {
        const worker = new Worker(__filename, {
            workerData: {
                walletData,
                workerId: i
            }
        });
        
        worker.on('message', (msg) => {
            if (msg.type === 'found') {
                found = true;
                clearInterval(progressInterval);
                console.log('\n🎉 PASSWORD FOUND! 🎉');
                console.log('Password:', msg.password);
                console.log('Mnemonic:', msg.mnemonic);
                cleanup();
                process.exit(0);
            } else if (msg.type === 'ready' || msg.type === 'needMore') {
                waitingWorkers.push(worker);
                sendPasswordsToWorker().catch(console.error);
            } else if (msg.type === 'progress') {
                totalTested += msg.count;
            }
        });
        
        worker.on('exit', (code) => {
            if (!found) {
                console.log(`Worker ${i} exited with code ${code}`);
                // Check if all workers are done
                const aliveWorkers = workers.filter(w => !w.killed);
                if (aliveWorkers.length === 0) {
                    if (eof) {
                        console.log('\n✗ Password not found in wordlist');
                    } else {
                        console.log('\n✗ All workers died unexpectedly');
                    }
                    cleanup();
                    process.exit(1);
                }
            }
        });
        
        worker.on('error', (error) => {
            console.error(`Worker ${i} error:`, error.message);
        });
        
        workers.push(worker);
    }
    
    // Initialize and start processing
    initializeFile().then(() => {
        // Workers will signal ready and start the process
    }).catch(error => {
        console.error('Failed to initialize:', error.message);
        process.exit(1);
    });
    
} else {
    // Worker thread
    const aes256 = require('aes256');
    const { walletData, workerId } = workerData;
    
    function testPassword(password) {
        try {
            let mnemonic = '';
            if (walletData[0].encrypted === true) {
                mnemonic = aes256.decrypt(password, walletData[0].mnemonic);
            } else {
                mnemonic = walletData[0].mnemonic;
            }
            
            const words = mnemonic.trim().split(' ');
            if (words.length === 34) {
                return mnemonic;
            }
            return false;
        } catch (error) {
            return false;
        }
    }
    
    let tested = 0;
    const progressReportInterval = 500; // Report every 500 passwords
    
    parentPort.on('message', (msg) => {
        if (msg.type === 'passwords') {
            for (const password of msg.passwords) {
                tested++;
                
                if (tested % progressReportInterval === 0) {
                    parentPort.postMessage({ type: 'progress', count: progressReportInterval });
                }
                
                const result = testPassword(password);
                if (result) {
                    parentPort.postMessage({ 
                        type: 'found', 
                        password: password, 
                        mnemonic: result 
                    });
                    return;
                }
            }
            
            // Report remaining progress for this batch
            const remainder = tested % progressReportInterval;
            if (remainder > 0) {
                parentPort.postMessage({ type: 'progress', count: remainder });
                tested -= remainder; // Reset counter
            }
            
            // Request more passwords
            parentPort.postMessage({ type: 'needMore' });
            
        } else if (msg.type === 'done') {
            // Report final progress
            const remainder = tested % progressReportInterval;
            if (remainder > 0) {
                parentPort.postMessage({ type: 'progress', count: remainder });
            }
            process.exit(0);
        }
    });
    
    // Signal ready
    parentPort.postMessage({ type: 'ready' });
}