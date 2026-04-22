require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.use('/whatsapp', require('./routes/webhook'))
app.use('/analytics', require('./routes/analytics'))
app.use('/gerar-faq', require('./routes/faq'))
app.use('/auth', require('./routes/auth').router)
app.use('/usuarios', require('./routes/usuarios'))
app.use('/crm', require('./routes/crm'))
app.use('/bellinha', require('./routes/bellinha'))

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
})

app.post('/perguntar', async (req, res) => {
    res.setTimeout(28000, () => res.status(504).json({ erro: 'Timeout na requisicao' }))
    try {
        const { pergunta } = req.body
        if (!pergunta) return res.status(400).json({ erro: 'Envie uma pergunta' })
        const { buscarSupabase } = require('./lib/rag')
        const { perguntarClaude } = require('./lib/claude')
        const contexto = await buscarSupabase(pergunta)
        const resposta = await perguntarClaude('', '', [], contexto, pergunta)
        return res.json({ resposta })
    } catch (err) {
        return res.status(500).json({ erro: err.message })
    }
})

app.get('/debug', async (req, res) => {
    try {
        const voyageKey = process.env.VOYAGE_API_KEY
        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voyageKey}` },
            body: JSON.stringify({ model: 'voyage-3-lite', input: 'teste' })
        })
        const data = await response.json()
        const embedding = response.ok ? data.data[0].embedding : null
        let supabase_result = null
        let supabase_error = null
        if (embedding) {
            const { supabase } = require('./lib/supabase')
            const { data: sbData, error: sbError } = await supabase.rpc('buscar_similar', { query_embedding: embedding, match_count: 2 })
            supabase_result = sbData?.length ?? 0
            supabase_error = sbError?.message ?? null
        }
        res.json({
            voyage_key_prefix: voyageKey?.slice(0, 8),
            voyage_status: response.status,
            voyage_ok: response.ok,
            supabase_key_length: process.env.SUPABASE_KEY?.length,
            supabase_key_prefix: process.env.SUPABASE_KEY?.slice(0, 15),
            supabase_resultados: supabase_result,
            supabase_error
        })
    } catch (err) {
        res.json({ erro: err.message })
    }
})

app.get('/', (req, res) => res.json({ status: 'Bellinha rodando' }))

process.on('uncaughtException', (err) => console.error('Erro nao tratado:', err.message))
process.on('unhandledRejection', (reason) => console.error('Promise rejeitada:', reason))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('Bellinha rodando na porta ' + PORT))
