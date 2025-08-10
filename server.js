// server.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// 環境変数からSupabaseの情報を取得
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Supabaseクライアントを初期化
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// JSON形式のリクエストボディをパース
app.use(express.json());

// ルートURLにアクセスされたときにindex.htmlを返す
// __dirnameはserver.jsが置かれているディレクトリを指します
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 静的ファイルを配信
// index.htmlがルートにあるので、静的ファイル（画像など）も同じフォルダに置くことを想定
app.use(express.static(__dirname));

// メッセージ取得用API
app.get('/api/messages', async (req, res) => {
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 新規メッセージ投稿用API
app.post('/api/messages', async (req, res) => {
    const { sender_id, content } = req.body;
    if (!sender_id || !content) {
        return res.status(400).json({ error: 'sender_id and content are required' });
    }

    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .insert({ sender_id, content });

        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.status(201).json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// メッセージ全削除用API
app.delete('/api/messages', async (req, res) => {
    const { password } = req.body;

    try {
        const { data: passwordData, error: passwordError } = await supabaseClient
            .from('passwords')
            .select('value')
            .eq('id', 'clear_password')
            .single();

        if (passwordError || passwordData.value !== password) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const { error: deleteError } = await supabaseClient
            .from('messages')
            .delete()
            .gt('id', 0);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }
        res.status(200).json({ message: 'Messages cleared successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// サーバー起動
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
