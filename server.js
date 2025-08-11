// server.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');
const app = express();
const port = process.env.PORT || 3000;

// 環境変数からSupabaseの情報を取得
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Supabaseクライアントを初期化（サービスロールキーを使用）
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// JSON形式のリクエストボディをパース
app.use(express.json());

// ファイルアップロードのための一時ストレージ
const upload = multer({ storage: multer.memoryStorage() });

// 静的ファイルを配信
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------
// 新しいAPIエンドポイント
// ------------------------------------

// ユーザー登録API
app.post('/api/auth/signup', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        res.status(201).json({ message: 'User registered successfully. Check your email for a verification link.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ユーザーログインAPI
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        res.json({ message: 'Login successful', user: data.user, session: data.session });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ファイルアップロードAPI
app.post('/api/upload', upload.single('image'), async (req, res) => {
    const { authorization } = req.headers;
    const { user } = await supabaseClient.auth.getUser(authorization.split(' ')[1]);

    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;

    try {
        const { data, error } = await supabaseClient.storage.from('images').upload(fileName, req.file.buffer, {
            contentType: req.file.mimetype
        });

        if (error) throw error;

        const publicUrl = supabaseClient.storage.from('images').getPublicUrl(fileName).data.publicUrl;

        // 投稿としてデータベースに保存
        const { data: postData, error: postError } = await supabaseClient
            .from('messages')
            .insert({ sender_id: user.email, content: `![](${publicUrl})` }); // Markdown形式で画像URLを投稿

        if (postError) throw postError;

        res.json({ message: 'File uploaded and posted successfully', url: publicUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ------------------------------------
// 既存のAPIエンドポイント
// ------------------------------------

// ルートURLにアクセスされたときにindex.htmlを返す
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
