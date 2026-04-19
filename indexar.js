const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const Anthropic = require('@anthropic-ai/sdk')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
)

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
})

function lerArquivosRecursivo(dir) {
    let arquivos = []
    const itens = fs.readdirSync(dir)
    for (const item of itens) {
        const caminho = path.join(dir, item)
        const stat = fs.statSync(caminho)
        if (stat.isDirectory()) {
            arquivos = arquivos.concat(lerArquivosRecursivo(caminho))
        } else if (item.endsWith('.txt')) {
            arquivos.push(caminho)
        }
    }
    return arquivos
}

function dividirTexto(texto, tamanho = 400) {
    const paragrafos = texto.split('\n\n').filter(Boolean)
    const pedacos = []
    let atual = ''

    for (const paragrafo of paragrafos) {
        if ((atual + paragrafo).split(' ').length > tamanho) {
            if (atual) pedacos.push(atual.trim())
            atual = paragrafo
        } else {
            atual += '\n\n' + paragrafo
        }
    }

    if (atual) pedacos.push(atual.trim())
    return pedacos
}

async function gerarEmbedding(texto) {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 10,
        system: 'Responda apenas: ok',
        messages: [{ role: 'user', content: texto }]
    })
    return null
}

async function indexar() {
    console.log('🔄 Iniciando indexação...')

    const docsDir = path.join(__dirname, 'docs')

    if (!fs.existsSync(docsDir)) {
        console.log('❌ Pasta docs não encontrada')
        return
    }

    console.log('🗑️  Limpando índice antigo...')
    await supabase.from('documentos').delete().neq('id', 0)

    const arquivos = lerArquivosRecursivo(docsDir)
    console.log(`📄 ${arquivos.length} arquivos encontrados`)

    for (const arquivo of arquivos) {
        const nomeArquivo = path.relative(__dirname, arquivo)
        console.log(`\n📝 Indexando: ${nomeArquivo}`)

        const texto = fs.readFileSync(arquivo, 'utf-8')
        const pedacos = dividirTexto(texto)

        console.log(`   ${pedacos.length} pedaços gerados`)

        for (let i = 0; i < pedacos.length; i++) {
            const pedaco = pedacos[i]

            try {
                // Gera embedding via OpenAI (mais barato para embeddings)
                const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'text-embedding-3-small',
                        input: pedaco,
                        dimensions: 1024
                    })
                })

                const embeddingData = await embeddingResponse.json()
                const embedding = embeddingData.data[0].embedding

                await supabase.from('documentos').insert({
                    arquivo: nomeArquivo,
                    conteudo: pedaco,
                    embedding: embedding
                })

                console.log(`   ✅ Pedaço ${i + 1}/${pedacos.length} indexado`)

            } catch (err) {
                console.error(`   ❌ Erro no pedaço ${i + 1}:`, err.message)
            }
        }
    }

    console.log('\n✅ Indexação concluída!')
}

indexar()
