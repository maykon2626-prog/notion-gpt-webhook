let tokenAtual = sessionStorage.getItem('dash_token') || ''
let graficoHoras = null

function mostrarErro(msg) {
  document.getElementById('erro').textContent = msg
}

function setCarregando(btnId, carregando, textoOriginal) {
  const btn = document.getElementById(btnId)
  btn.disabled = carregando
  btn.textContent = carregando ? 'Aguarde...' : textoOriginal
}

async function solicitarCodigo() {
  const numero = document.getElementById('input-telefone').value.trim()
  if (!numero) return mostrarErro('Informe o número de WhatsApp')
  mostrarErro('')
  setCarregando('btn-enviar', true, 'Enviar código')

  const r = await fetch('/auth/solicitar-codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero })
  })
  const data = await r.json()
  setCarregando('btn-enviar', false, 'Enviar código')

  if (!r.ok) return mostrarErro(data.erro || 'Erro ao enviar código')

  document.getElementById('passo-telefone').style.display = 'none'
  document.getElementById('passo-codigo').style.display = 'block'
  document.getElementById('input-codigo').focus()
}

async function verificarCodigo() {
  const numero = document.getElementById('input-telefone').value.trim()
  const codigo = document.getElementById('input-codigo').value.trim()
  if (!codigo) return mostrarErro('Informe o código recebido')
  mostrarErro('')
  setCarregando('btn-verificar', true, 'Verificar')

  const r = await fetch('/auth/verificar-codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero, codigo })
  })
  const data = await r.json()
  setCarregando('btn-verificar', false, 'Verificar')

  if (!r.ok) return mostrarErro(data.erro || 'Código inválido')

  tokenAtual = data.token
  sessionStorage.setItem('dash_token', tokenAtual)
  await carregarDashboard()
}

function voltarTelefone() {
  document.getElementById('passo-codigo').style.display = 'none'
  document.getElementById('passo-telefone').style.display = 'block'
  document.getElementById('input-codigo').value = ''
  mostrarErro('')
}

async function carregarDashboard() {
  const r = await fetch('/analytics', { headers: { 'x-token': tokenAtual } })
  if (r.status === 401) {
    sessionStorage.removeItem('dash_token')
    tokenAtual = ''
    return
  }
  const data = await r.json()
  document.getElementById('login').style.display = 'none'
  document.getElementById('app').style.display = 'block'
  renderizar(data)
}

if (tokenAtual) carregarDashboard()

async function filtrar() {
  const de = document.getElementById('f-de').value
  const ate = document.getElementById('f-ate').value
  const params = new URLSearchParams()
  if (de) params.append('de', de)
  if (ate) params.append('ate', ate)
  const url = '/analytics' + (params.toString() ? '?' + params.toString() : '')
  document.getElementById('f-label').textContent = de || ate ? `Filtrando: ${de || 'início'} → ${ate || 'hoje'}` : ''
  const r = await fetch(url, { headers: { 'x-token': tokenAtual } })
  renderizar(await r.json())
}

async function limparFiltro() {
  document.getElementById('f-de').value = ''
  document.getElementById('f-ate').value = ''
  document.getElementById('f-label').textContent = ''
  const r = await fetch('/analytics', { headers: { 'x-token': tokenAtual } })
  renderizar(await r.json())
}

function renderizar(d) {
  document.getElementById('total-corretores').textContent = d.total_corretores
  document.getElementById('total-mensagens').textContent = d.total_mensagens
  document.getElementById('total-lacunas').textContent = d.lacunas_pendentes.length
  document.getElementById('total-faqs').textContent = d.faqs_gerados.length

  document.getElementById('tb-corretores').innerHTML = d.por_corretor.slice(0, 10).map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${c.nome}</td>
      <td><a href="https://wa.me/${c.telefone}" target="_blank" style="color:#7A8C5F;text-decoration:none;font-size:13px">📱 ${c.telefone}</a></td>
      <td><span class="tag">${c.tipo}</span></td>
      <td>${c.mensagens}</td>
    </tr>
  `).join('')

  const maxImob = Math.max(...d.por_imobiliaria.map(i => i.count), 1)
  document.getElementById('imob-list').innerHTML = d.por_imobiliaria.map(i => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>${i.label}</span>
        <span style="color:#8C8880">${i.corretores} corretor${i.corretores !== 1 ? 'es' : ''} · ${i.count} msgs</span>
      </div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(i.count / maxImob * 100)}%"></div></div>
    </div>
  `).join('')

  const maxProd = Math.max(...Object.values(d.por_produto), 1)
  document.getElementById('prod-list').innerHTML = Object.entries(d.por_produto)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px"><span>${k}</span><span>${v}</span></div>
        <div class="bar-wrap"><div class="bar" style="width:${Math.round(v / maxProd * 100)}%"></div></div>
      </div>
    `).join('')

  document.getElementById('lacunas-list').innerHTML = d.lacunas_pendentes.length
    ? d.lacunas_pendentes.map(l => `<div class="lacuna">❓ ${l.pergunta}</div>`).join('')
    : '<p style="color:#8C8880;font-size:13px">Nenhuma lacuna pendente 🎉</p>'

  if (d.por_hora) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)
    if (graficoHoras) graficoHoras.destroy()
    graficoHoras = new Chart(document.getElementById('grafico-horas'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Mensagens',
          data: d.por_hora,
          backgroundColor: '#7A8C5F',
          borderRadius: 4
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { grid: { display: false } }
        }
      }
    })
  }

  if (d.tokens) {
    document.getElementById('tokens-entrada').textContent = d.tokens.entrada.toLocaleString('pt-BR')
    document.getElementById('tokens-saida').textContent = d.tokens.saida.toLocaleString('pt-BR')
    document.getElementById('custo-usd').textContent = `$${d.tokens.custo_usd}`
    if (d.tokens.saldo_usd !== null) {
      document.getElementById('saldo-usd').textContent = `$${d.tokens.saldo_usd}`
      document.getElementById('card-saldo').style.display = 'block'
    }
  }
}
