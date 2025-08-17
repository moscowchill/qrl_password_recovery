# QRL Password Recovery Tool

A memory-efficient multi-threaded password recovery tool for QRL (Quantum Resistant Ledger) wallets.

## Features

- **Memory Efficient**: Processes large password lists without loading them entirely into memory
- **Multi-threaded**: Utilizes all CPU cores for maximum performance
- **Streaming**: Reads password files in small chunks to avoid memory overflow
- **Progress Tracking**: Real-time progress reporting with passwords/second rate
- **Configurable**: Adjustable thread count and chunk sizes

## Requirements

- Node.js (tested with v18+)
- npm packages: `aes256`, `worker_threads` (built-in)

## Installation

```bash
npm install aes256
```

## Usage

```bash
node qrl_password_recovery.js [options]
```

### Options

- `--wallet <file>`: Wallet file (default: wallet.json)
- `--wordlist <file>`: Password wordlist file (default: weakpass_4.txt)  
- `--threads <num>`: Number of worker threads (default: CPU cores)
- `--chunk-size <num>`: File chunk size in bytes (default: 8192)
- `--help`, `-h`: Show help message

### Examples

```bash
# Basic usage
node qrl_password_recovery.js --wallet mywallet.json --wordlist passwords.txt

# Custom thread count and chunk size
node qrl_password_recovery.js --wallet mywallet.json --wordlist passwords.txt --threads 4 --chunk-size 4096

# Show help
node qrl_password_recovery.js --help
```

## How It Works

1. **File Streaming**: Reads the password wordlist in small chunks (default 8KB)
2. **Worker Distribution**: Distributes password batches across multiple worker threads
3. **Password Testing**: Each worker attempts to decrypt the wallet with assigned passwords
4. **Success Detection**: Stops immediately when the correct password is found
5. **Progress Reporting**: Shows progress every 10 seconds with rate statistics

## Memory Optimization

This tool is designed to handle very large password lists without memory issues:

- Reads files in configurable chunks (default 8KB)
- Processes passwords immediately without buffering
- Uses worker threads to distribute load
- Minimal memory footprint regardless of wordlist size

## Wallet Format

Expects QRL wallet files in JSON format with structure:
```json
[
  {
    "encrypted": true,
    "mnemonic": "encrypted_mnemonic_data"
  }
]
```

## Wordlist Format

Password wordlists should be plain text files with:
- One password per line
- Lines starting with `#` are ignored (comments)
- Empty lines are skipped

## Output

When successful, the tool outputs:
- The correct password
- The decrypted mnemonic phrase

## Performance Tips

- Use SSD storage for better I/O performance
- Adjust `--chunk-size` based on available memory
- Use `--threads` to match your CPU capabilities
- Sort wordlists by likelihood for faster results

## Troubleshooting

### Memory Issues
- Reduce `--chunk-size` (try 4096 or 2048)
- Reduce `--threads` if system becomes unresponsive

### Performance Issues  
- Increase `--chunk-size` for better I/O (try 16384 or 32768)
- Ensure wordlist file is on fast storage (SSD)

### File Not Found
- Check file paths are correct
- Ensure wordlist file exists and is readable