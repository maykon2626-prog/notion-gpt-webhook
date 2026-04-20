const express = require('express')
const router = express.Router()

const { supabase, carregarConversa, salvarConversa } = require('../lib/supabase')
const { claudeCreate, extrairInfoCorretor, normalizarTipo, detectarProduto, resolverProduto, gerarResumo, perguntarClaude } = require('../lib/claude')
const { buscarSupabase } = require('../lib/rag')
const { enviarWhatsApp, baixarImagemBase64 } = require('../lib/whatsapp')

const LIMITE_MENSAGENS = 30

router.post('/', async (req, res) => {
    try {
        const msg = req.body

        const texto = msg?.data?.message?.conversation ||
                      msg?.data?.message?.extendedTextMessage?.text ||
                      msg?.data?.message?.imageMessage?.caption || ''

        const imagemPresente = !!msg?.data?.message?.imageMessage
        const numero = msg?.data?.key?.remoteJid
        const fromMe = msg?.data?.key?.fromMe
        const isGrupo = numero?.endsWith('@g.us')

        if ((!texto && !imagemPresente) || !numero || fromMe) return res.sendStatus(200)

        const mencionada = /bel{1,2}inha/i.test(texto)
        const pedindoParar = /para(r|rar)?|encerr(ar?|a)|obrigad[ao]|tchau|até mais|valeu/i.test(texto)

        if (isGrupo) {
            const { nome: nomeGrupo, tipo: tipoGrupo, resumo: resumoGrupo, mensagens: mensagensGrupo, ativo: ativoGrupo } = await carregarConversa(numero)
            const remetente = msg?.data?.key?.participant || numero

            const { data: dadosRemetente } = await supabase
                .from('conversas')
                .select('nome, tipo, pendente_grupo')
                .eq('numero', remetente)
                .single()

            const nomeRemetente = dadosRemetente?.nome || ''
            const tipoRemetente = dadosRemetente?.tipo || ''
            const pendente = dadosRemetente?.pendente_grupo || ''

            if (pendente === numero) {
                const extracaoNome = await claudeCreate({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 50,
                    system: 'Extraia apenas o primeiro nome da mensagem. Responda APENAS em JSON: {"nome": "..."}. Se não identificar um nome, use o texto original.',
                    messages: [{ role: 'user', content: texto }]
                })
                let nomeSalvo = texto.trim()
                try {
                    const info = JSON.parse(extracaoNome.content[0].text)
                    nomeSalvo = info.nome || texto.trim()
                } catch {}

                await supabase.from('conversas').upsert({
                    numero: remetente, nome: nomeSalvo, pendente_grupo: '', atualizado_em: new Date().toISOString()
                }, { onConflict: 'numero' })

                await enviarWhatsApp(numero, `Prazer, ${nomeSalvo}! 😊 Como posso te ajudar?`)
                return res.sendStatus(200)
            }

            const labelRemetente = nomeRemetente
                ? (tipoRemetente ? `${nomeRemetente} (${tipoRemetente})` : nomeRemetente)
                : remetente

            mensagensGrupo.push({ role: 'user', content: `[${labelRemetente}]: ${texto}` })

            let novoAtivo = ativoGrupo
            if (mencionada) novoAtivo = true
            if (ativoGrupo && pedindoParar) novoAtivo = false

            if (mensagensGrupo.length >= LIMITE_MENSAGENS) {
                const novoResumo = await gerarResumo('Grupo', resumoGrupo, mensagensGrupo)
                await salvarConversa(numero, nomeGrupo, tipoGrupo, novoResumo, [], novoAtivo)
            } else {
                await salvarConversa(numero, nomeGrupo, tipoGrupo, resumoGrupo, mensagensGrupo, novoAtivo)
            }

            if (!novoAtivo) return res.sendStatus(200)

            if (ativoGrupo && pedindoParar) {
                await enviarWhatsApp(numero, 'De nada! 😊 Estarei aqui se precisar. Até mais!')
                return res.sendStatus(200)
            }

            if (mencionada && !nomeRemetente) {
                await supabase.from('conversas').upsert({
                    numero: remetente, nome: '', pendente_grupo: numero, atualizado_em: new Date().toISOString()
                }, { onConflict: 'numero' })
                await enviarWhatsApp(numero, 'Olá! 😊 Ainda não nos conhecemos. Qual é o seu nome?')
                return res.sendStatus(200)
            }
        }

        console.log('WhatsApp - De:', numero)
        console.log('WhatsApp - Texto:', texto)
        console.log('WhatsApp - Grupo:', isGrupo)

        let imagemBase64 = null
        if (imagemPresente) {
            imagemBase64 = await baixarImagemBase64(msg)
            console.log('Imagem baixada:', imagemBase64 ? 'sim' : 'falhou')
        }

        const textoPuro = texto.replace(/@?bel{1,2}inha/gi, '').trim()

        let { nome, tipo, resumo, mensagens, ativo, pendente_produto: pendenteProduto } = await carregarConversa(numero)

        if (isGrupo) {
            const remetente = msg?.data?.key?.participant || numero
            const { data: dadosRem } = await supabase.from('conversas').select('nome, tipo').eq('numero', remetente).single()
            nome = dadosRem?.nome || ''
            tipo = dadosRem?.tipo || ''
        }

        if (!isGrupo) {
            if (!nome) {
                if (mensagens.length === 0) {
                    const boasVindas = 'Olá! 😊 Sou a Bellinha, assistente virtual da Bella Casa & Okada.\n\nAcho que a gente ainda não se conhece! Qual é o seu nome?'
                    mensagens.push({ role: 'assistant', content: boasVindas })
                    await salvarConversa(numero, '', '', '', mensagens)
                    await enviarWhatsApp(numero, boasVindas)
                    return res.sendStatus(200)
                }

                const info = await extrairInfoCorretor(textoPuro)
                nome = info.nome || textoPuro
                tipo = info.tipo || ''
                mensagens.push({ role: 'user', content: textoPuro })

                if (tipo) {
                    const saudacao = `Prazer, ${nome}! 😊 ${tipo === 'Autônomo' ? 'Autônomo, ' : `Da ${tipo}, `}${nome}! Pode perguntar, estou aqui para te ajudar!`
                    mensagens.push({ role: 'assistant', content: saudacao })
                    await salvarConversa(numero, nome, tipo, resumo, mensagens)
                    await enviarWhatsApp(numero, saudacao)
                } else {
                    const perguntaTipo = `Prazer, ${nome}! 😊 Você trabalha em alguma imobiliária? Se sim, qual? Ou é autônomo?`
                    mensagens.push({ role: 'assistant', content: perguntaTipo })
                    await salvarConversa(numero, nome, '', resumo, mensagens)
                    await enviarWhatsApp(numero, perguntaTipo)
                }
                return res.sendStatus(200)
            }
        }

        if (!isGrupo && !tipo) {
            tipo = await normalizarTipo(textoPuro)

            mensagens.push({ role: 'user', content: textoPuro })
            const saudacao = `Anotado! 😊 ${tipo === 'Autônomo' ? 'Autônomo, ' : `Da ${tipo}, `}${nome}! Pode perguntar, estou aqui para te ajudar!`
            mensagens.push({ role: 'assistant', content: saudacao })
            await salvarConversa(numero, nome, tipo, resumo, mensagens)
            await enviarWhatsApp(numero, saudacao)
            return res.sendStatus(200)
        }

        supabase.from('mensagens_log').insert({ numero }).then(({ error }) => {
            if (error) console.error('Erro log mensagem:', error.message)
        })

        if (!isGrupo && pendenteProduto) {
            const { candidatos, pergunta_original } = pendenteProduto
            const produto = await resolverProduto(textoPuro, candidatos)
            await supabase.from('conversas').update({ pendente_produto: null }).eq('numero', numero)
            const contexto = await buscarSupabase(`${produto} ${pergunta_original}`)
            mensagens.push({ role: 'user', content: pergunta_original })
            const resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contexto, pergunta_original)
            mensagens.push({ role: 'assistant', content: resposta })
            if (mensagens.length >= LIMITE_MENSAGENS) { resumo = await gerarResumo(nome, resumo, mensagens); mensagens = [] }
            await salvarConversa(numero, nome, tipo, resumo, mensagens, ativo)
            await enviarWhatsApp(numero, resposta)
            return res.sendStatus(200)
        }

        const deteccao = await detectarProduto(textoPuro)
        if (deteccao.ambiguo && deteccao.candidatos?.length > 1) {
            const lista = deteccao.candidatos.map((p, i) => `${i + 1}. ${p}`).join('\n')
            const msgAmb = `Encontrei ${deteccao.candidatos.length} empreendimentos com esse nome:\n\n${lista}\n\nSobre qual você gostaria de saber?`
            await supabase.from('conversas').upsert({
                numero, pendente_produto: { candidatos: deteccao.candidatos, pergunta_original: textoPuro }, atualizado_em: new Date().toISOString()
            }, { onConflict: 'numero' })
            mensagens.push({ role: 'user', content: textoPuro })
            mensagens.push({ role: 'assistant', content: msgAmb })
            await salvarConversa(numero, nome, tipo, resumo, mensagens, ativo)
            await enviarWhatsApp(numero, msgAmb)
            return res.sendStatus(200)
        }

        const contexto = await buscarSupabase(deteccao.produto ? `${deteccao.produto} ${textoPuro}` : textoPuro)
        console.log('Contexto tamanho:', contexto.length)

        mensagens.push({ role: 'user', content: textoPuro })

        let resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contexto, textoPuro, imagemBase64)

        const respostaInsuficiente = /não tenho esse dado|não encontrei|sem (contexto|informaç)/i.test(resposta)
        if (respostaInsuficiente) {
            await supabase.from('lacunas').insert({ pergunta: textoPuro, resposta_bellinha: resposta, numero })
            const contextoExtra = await buscarSupabase(textoPuro, 8)
            if (contextoExtra && contextoExtra.length > contexto.length) {
                console.log('Tentando com contexto expandido...')
                resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contextoExtra, textoPuro, imagemBase64)
            }
        }

        mensagens.push({ role: 'assistant', content: resposta })

        if (mensagens.length >= LIMITE_MENSAGENS) {
            console.log('Gerando resumo para', numero)
            resumo = await gerarResumo(nome, resumo, mensagens)
            mensagens = []
        }

        await salvarConversa(numero, nome, tipo, resumo, mensagens, ativo)
        await enviarWhatsApp(numero, resposta)

        return res.sendStatus(200)

    } catch (err) {
        console.error('Erro no WhatsApp:', err.message)
        return res.sendStatus(200)
    }
})

module.exports = router
