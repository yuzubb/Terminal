// server.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Renderの環境変数からSupabaseの情報を取得
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Supabaseクライアントの初期化
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// JSON形式のリクエストボディをパースするためのミドルウェア
app.use(express.json());

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// メッセージ取得用のAPIエンドポイント
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

// 新しいメッセージ投稿用のAPIエンドポイント
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

// `/clear`コマンド用のAPIエンドポイント (パスワードによる認証付き)
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

// サーバーの起動
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
