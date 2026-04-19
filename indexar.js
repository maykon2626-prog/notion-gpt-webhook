require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

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
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: texto,
            dimensions: 1024
        })
    })

    const data = await response.json()
    console.log('   OpenAI status:', response.status)

    if (!response.ok) {
        throw new Error(data.error?.message || 'Erro OpenAI')
    }

    if (!data.data || !data.data[0]) {
        console.error('   Resposta completa:', JSON.stringify(data).slice(0, 500))
        throw new Error('Embedding nao retornado')
    }

    return data.data[0].embedding
}

async function indexar() {
    console.log('Iniciando indexacao...')

    const docsDir = path.join(__dirname, 'docs')
    if (!fs.existsSync(docsDir)) {
        console.log('Pasta docs nao encontrada')
        return
    }

    console.log('Limpando indice antigo...')
    await supabase.from('documentos').delete().neq('id', 0)

    const arquivos = lerArquivosRecursivo(docsDir)
    console.log(arquivos.length + ' arquivos encontrados')

    for (const arquivo of arquivos) {
        const nome = path.relative(__dirname, arquivo)
        console.log('Indexando: ' + nome)

        const texto = fs.readFileSync(arquivo, 'utf-8')
        const pedacos = dividirTexto(texto)
        console.log(pedacos.length + ' pedacos')

        for (let i = 0; i < pedacos.length; i++) {
            try {
                const embedding = await gerarEmbedding(pedacos[i])
                const { error } = await supabase.from('documentos').insert({
                    arquivo: nome,
                    conteudo: pedacos[i],
                    embedding
                })
                if (error) {
                    console.error('Erro Supabase:', error.message)
                } else {
                    console.log('Pedaco ' + (i + 1) + '/' + pedacos.length + ' ok')
                }
            } catch (err) {
                console.error('Erro pedaco ' + (i + 1) + ':', err.message)
            }
        }
    }

    console.log('Indexacao concluida!')
}

indexar()