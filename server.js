// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const Docker = require('dockerode');
const { Writable } = require('stream');

const app = express();
const port = 3000;

// Dockerデーモンへの接続（Unixソケット/Windows named pipeを使用）
// Renderなどの環境では、この設定は環境変数やサービス接続によって異なります
const docker = new Docker();

// セッションとコンテナIDのマッピング
// 簡易的にメモリで管理しますが、本番ではデータベースが必要です
const sessions = {}; // { sessionId: containerId }

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Docker コンテナ管理関数 ---

// 新しいコンテナを作成・起動
async function createContainer(sessionId) {
    // ログ記録
    console.log(`[SYS] Creating container for session: ${sessionId}`);

    // Dockerfileで作成したカスタムイメージ 'my-terminal-env' を使用するのが理想
    // ここでは Ubuntu を使用します
    const container = await docker.createContainer({
        Image: 'ubuntu:latest', 
        Tty: true, 
        OpenStdin: true, 
        AttachStdout: true,
        AttachStderr: true,
        // HostConfigでリソース制限やネットワーク分離を設定し、ホストOSを保護します
        HostConfig: {
            // ReadonlyRootfs: true, // 実験の自由度を保つため今回は false に
            Memory: 512 * 1024 * 1024, // 512MB メモリ制限
            NetworkMode: 'none', // ネットワークアクセスを禁止 (外部へのアクセスを禁止し安全性向上)
        },
        name: `terminal-session-${sessionId}-${Date.now()}`,
    });

    await container.start();
    sessions[sessionId] = container.id;
    
    console.log(`[SYS] Container started: ${container.id}`);
    return container;
}

// コンテナを停止・削除
async function removeContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.stop({ t: 10 }); // 10秒で停止
        await container.remove({ force: true });
        console.log(`[SYS] Container removed: ${containerId}`);
    } catch (e) {
        console.warn(`[WARN] Could not stop/remove container ${containerId}: ${e.message}`);
    }
}


// --- API エンドポイント ---

// 1. コマンド実行エンドポイント
app.post('/api/run', async (req, res) => {
    const { sessionId, command } = req.body;
    let containerId = sessions[sessionId];

    // 初回アクセス/セッション切れの場合、コンテナを起動
    if (!containerId) {
        try {
            const container = await createContainer(sessionId);
            containerId = container.id;
        } catch (error) {
            console.error('[ERR] Container creation failed:', error);
            return res.status(500).json({ output: 'Error: Could not start terminal environment.', exitCode: 1 });
        }
    }

    // ⚠️ すべての入力をログに記録
    console.log(`[REQ] Session: ${sessionId}, Command: "${command}"`);

    const container = docker.getContainer(containerId);
    
    // コマンド実行 (sh -c を使用し、インストールなど複雑なコマンドも許可)
    const exec = await container.exec({
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
    });

    try {
        const stream = await exec.start({ Detach: false });

        let stdout = '';
        let stderr = '';
        let fullLog = '';

        // Dockerストリームの処理 (stdout/stderrヘッダーを解析)
        // ここでの処理は複雑ですが、ログの分離とキャプチャのために必須です
        const writableStream = new Writable({
            write(chunk, encoding, callback) {
                // Dockerストリームヘッダー: [STREAM_TYPE (1 byte), SIZE (3 bytes), PAYLOAD (N bytes)]
                const streamType = chunk[0];
                const payload = chunk.slice(8); // ヘッダーは8バイト
                const text = payload.toString('utf8');

                fullLog += text; // すべての出力をフルログに記録

                if (streamType === 1) { // stdout
                    stdout += text;
                } else if (streamType === 2) { // stderr
                    stderr += text;
                }
                
                // ⚠️ 実行途中のログを出力
                process.stdout.write(`[LOG-MID] Session: ${sessionId}, Output: ${text.trim()}\n`);

                callback();
            }
        });
        
        stream.pipe(writableStream);

        // ストリーム終了と終了コードの取得
        stream.on('end', async () => {
            const inspect = await exec.inspect();
            const exitCode = inspect.ExitCode;

            // ⚠️ 最終的な実行結果をログに記録
            console.log(`[RES] Session: ${sessionId}, ExitCode: ${exitCode}`);
            console.log(`[RES] Full Terminal Output:\n---\n${fullLog.trim()}\n---\n`);
            
            res.json({
                // フロントエンドにはstdoutとstderrを分けて返す
                output: stdout.trim(), 
                error: stderr.trim(),
                exitCode: exitCode
            });
        });

    } catch (error) {
        console.error('[ERR] Execution failed:', error);
        res.status(500).json({ output: `Execution Error: ${error.message}` });
    }
});


// 2. リセットエンドポイント
app.post('/api/reset', async (req, res) => {
    const { sessionId } = req.body;
    const oldContainerId = sessions[sessionId];

    console.log(`[REQ] Session: ${sessionId}, Action: Resetting environment.`);

    if (oldContainerId) {
        await removeContainer(oldContainerId);
        delete sessions[sessionId];
    }

    // 新しいコンテナを起動
    try {
        await createContainer(sessionId);
        res.json({ output: 'Terminal environment reset complete. New session started.', error: null });
    } catch (error) {
        console.error('[ERR] Reset failed:', error);
        res.status(500).json({ output: 'Error: Failed to start new terminal environment.', error: null });
    }
});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('--- SYSTEM LOGS ---');
});
