let senhaAtual = ''

async function entrar() {
  const s = document.getElementById('senha').value
  const r = await fetch('/analytics', { headers: { 'x-senha': s } })
  if (r.status === 401) {
    document.getElementById('erro').textContent = 'Senha incorreta'
    return
  }
  senhaAtual = s
  const data = await r.json()
  document.getElementById('login').style.display = 'none'
  document.getElementById('app').style.display = 'block'
  renderizar(data)
}

async function filtrar() {
  const de = document.getElementById('f-de').value
  const ate = document.getElementById('f-ate').value
  const params = new URLSearchParams()
  if (de) params.append('de', de)
  if (ate) params.append('ate', ate)
  const url = '/analytics' + (params.toString() ? '?' + params.toString() : '')
  document.getElementById('f-label').textContent = de || ate ? `Filtrando: ${de || 'início'} → ${ate || 'hoje'}` : ''
  const r = await fetch(url, { headers: { 'x-senha': senhaAtual } })
  renderizar(await r.json())
}

async function limparFiltro() {
  document.getElementById('f-de').value = ''
  document.getElementById('f-ate').value = ''
  document.getElementById('f-label').textContent = ''
  const r = await fetch('/analytics', { headers: { 'x-senha': senhaAtual } })
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
      <td><a href="https://wa.me/${c.telefone}" target="_blank" style="color:#25d366;text-decoration:none;font-size:13px">📱 ${c.telefone}</a></td>
      <td><span class="tag">${c.tipo}</span></td>
      <td>${c.mensagens}</td>
    </tr>
  `).join('')

  const maxImob = Math.max(...d.por_imobiliaria.map(i => i.count), 1)
  document.getElementById('imob-list').innerHTML = d.por_imobiliaria.map(i => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>${i.label}</span>
        <span style="color:#888">${i.corretores} corretor${i.corretores !== 1 ? 'es' : ''} · ${i.count} msgs</span>
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
    : '<p style="color:#aaa;font-size:13px">Nenhuma lacuna pendente 🎉</p>'

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
