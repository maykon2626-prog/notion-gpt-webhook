async function baixarImagemBase64(msg) {
    try {
        const response = await fetch(`${process.env.EVOLUTION_URL}/chat/getBase64FromMediaMessage/${process.env.EVOLUTION_INSTANCE}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.EVOLUTION_KEY
            },
            body: JSON.stringify({ message: { key: msg.data.key, message: msg.data.message } })
        })
        const data = await response.json()
        return data.base64 || null
    } catch (err) {
        console.error('Erro ao baixar imagem:', err.message)
        return null
    }
}

async function enviarWhatsApp(numero, texto) {
    try {
        await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.EVOLUTION_KEY
            },
            body: JSON.stringify({ number: numero, text: texto })
        })
    } catch (err) {
        console.error('Erro ao enviar WhatsApp:', err.message)
    }
}

module.exports = { baixarImagemBase64, enviarWhatsApp }
