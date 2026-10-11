const fs = require('fs');
const path = require('path');
const https = require('https');

const token = process.env.GH_TOKEN;
const releaseId = 403251600;
const repo = 'Rizz2001/chekin';

async function uploadAsset(filePath, name) {
    const stat = fs.statSync(filePath);
    const options = {
        hostname: 'uploads.github.com',
        port: 443,
        path: `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'User-Agent': 'Node.js'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`Successfully uploaded ${name}`);
                    resolve(responseBody);
                } else {
                    console.error(`Failed to upload ${name}. Status: ${res.statusCode}`);
                    console.error(responseBody);
                    reject(new Error(`Status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => reject(e));

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(req);
    });
}

async function main() {
    try {
        console.log('Uploading latest.yml...');
        await uploadAsset(path.join(__dirname, 'dist', 'latest.yml'), 'latest.yml');
        
        console.log('Uploading Chekin-Setup-1.0.6.exe...');
        await uploadAsset(path.join(__dirname, 'dist', 'Chekin Setup 1.0.6.exe'), 'Chekin-Setup-1.0.6.exe');
        
        console.log('All uploads finished successfully.');
    } catch (e) {
        console.error('Error during upload:', e);
    }
}

main();
