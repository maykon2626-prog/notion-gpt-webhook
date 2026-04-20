const { supabase } = require('./supabase')

async function gerarEmbedding(texto) {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
        },
        body: JSON.stringify({ model: 'voyage-3-lite', input: texto })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.detail || 'Erro Voyage')
    return data.data[0].embedding
}

async function buscarSupabase(pergunta, limite = 4) {
    try {
        const embedding = await gerarEmbedding(pergunta)
        const { data, error } = await supabase.rpc('buscar_similar', {
            query_embedding: embedding,
            match_count: limite
        })
        if (error) throw new Error(error.message)
        if (!data || data.length === 0) return ''
        return data.map(d => d.conteudo).join('\n\n---\n\n')
    } catch (err) {
        console.error('Erro busca Supabase:', err.message)
        return ''
    }
}

module.exports = { gerarEmbedding, buscarSupabase }
