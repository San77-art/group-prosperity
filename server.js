// server.js
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Caminhos dos arquivos
const USUARIOS_FILE = path.join(__dirname, 'usuarios.json');
const FILA_FILE = path.join(__dirname, 'fila.json');
const GIROS_FILE = path.join(__dirname, 'giros.json');
const CAIXA_FILE = path.join(__dirname, 'caixa.json');
const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');

// Cria pastas se não existirem
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 🔐 Sessão segura
app.use(session({
  secret: process.env.SESSION_SECRET || 'MeuSistemaSeguro123!@#',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 60 * 1000 } // 30 minutos
}));

// 🔐 Middleware: verificar login
function verificaLogin(req, res, next) {
  if (req.session.usuario) {
    next();
  } else {
    res.redirect('/?erro=1');
  }
}

// 🔒 Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erro: 'Muitas tentativas. Tente em 15 min.' }
});

const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { erro: 'Muitos cadastros. Tente em 1 hora.' }
});

// 📂 Funções de leitura e salvamento

function lerUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(USUARIOS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Erro ao ler usuarios.json:', err);
    return [];
  }
}

function salvarUsuarios(usuarios) {
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));
}

function lerFila() {
  try {
    return JSON.parse(fs.readFileSync(FILA_FILE, 'utf-8'));
  } catch (err) {
    return { "2": [], "3": [], "4": [], "5": [] };
  }
}

function salvarFila(fila) {
  fs.writeFileSync(FILA_FILE, JSON.stringify(fila, null, 2));
}

function lerGiros() {
  try {
    return JSON.parse(fs.readFileSync(GIROS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

// ✅ Caixa do sistema (retenção de 10%)
function lerCaixa() {
  try {
    return JSON.parse(fs.readFileSync(CAIXA_FILE, 'utf-8'));
  } catch (err) {
    return { totalRetido: 0, movimentacoes: [] };
  }
}

function salvarCaixa(caixa) {
  fs.writeFileSync(CAIXA_FILE, JSON.stringify(caixa, null, 2));
}

function registrarRetencao(valor, descricao = '') {
  const caixa = lerCaixa();
  caixa.totalRetido += valor;
  caixa.movimentacoes.push({
    data: new Date().toISOString().split('T')[0],
    valor,
    tipo: 'retencao',
    descricao
  });
  salvarCaixa(caixa);
}

// 🔄 Processar fila automaticamente (a cada 5 minutos)
function processarFilaAutomaticamente() {
  const fila = lerFila();
  const usuarios = lerUsuarios();
  const giros = lerGiros();

  for (let nivel = 2; nivel <= 5; nivel++) {
    const filaNivel = fila[nivel];
    if (filaNivel && filaNivel.length > 0) {
      const primeiro = filaNivel.shift();
      const user = usuarios.find(u => u.usuario === primeiro.usuario);

      if (user) {
        const giroAtual = giros.find(g => g.nivel === user.nivel);
        if (giroAtual) {
          const valorRetido = giroAtual.valor * 0.1;
          registrarRetencao(valorRetido, `Retenção Giro ${user.nivel} - ${user.usuario}`);

          user.nivel += 1;
          user.ultimo_giro = new Date().toISOString().split('T')[0];
          console.log(`✅ ${user.usuario} avançou para o Giro ${user.nivel}`);
        }
      }
    }
  }

  salvarFila(fila);
  salvarUsuarios(usuarios);
}

// Executar a cada 5 minutos (300000 ms)
setInterval(processarFilaAutomaticamente, 300000); // 5 minutos
processarFilaAutomaticamente(); // Executar agora na inicialização

// 🌐 ROTAS

// Rota: GET / → login.html
app.get('/', (req, res) => {
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const erro = params.get('erro');
  const sucesso = params.get('sucesso');
  const cadastro = params.get('cadastro');

  fs.readFile(path.join(__dirname, 'public', 'login.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Erro ao carregar página.');

    let html = data;

    if (cadastro === 'ok') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-success">Cadastro realizado! Faça login abaixo.</div>');
    } else if (sucesso === '1') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-success">Login realizado com sucesso!</div>');
    } else if (erro === '1') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-danger">Usuário ou senha inválidos</div>');
    }

    res.send(html);
  });
});

// Rota: POST /login
app.post('/login', loginLimiter, (req, res) => {
  const { usuario, senha } = req.body;
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === usuario);

  if (user && bcrypt.compareSync(senha, user.senha)) {
    req.session.usuario = user.usuario;
    req.session.nome = `${user.nome} ${user.sobre}`;
    return res.redirect('/index.html?sucesso=1');
  } else {
    return res.redirect('/?erro=1');
  }
});

// Rota: GET /index.html
app.get('/index.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota: GET /new-account.html
app.get('/new-account.html', cadastroLimiter, (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'new-account.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Erro ao carregar página.');

    let html = data;
    const params = new URLSearchParams(req.url.split('?')[1] || '');

    if (params.get('erro') === 'usuario-existe') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-danger">Usuário já cadastrado.</div>');
    } else if (params.get('erro') === 'senha') {
      const detalhe = decodeURIComponent(params.get('detalhe') || '');
      html = html.replace('<!-- MENSAGEM -->', `<div class="alert alert-warning">Senha fraca: ${detalhe}.</div>`);
    }

    res.send(html);
  });
});

// Rota: POST /cadastrar
app.post('/cadastrar', cadastroLimiter, async (req, res) => {
  const { nome, sobre, celular, email, patrocinador, usuario, senha, senha2 } = req.body;
  const usuarios = lerUsuarios();

  if (usuarios.some(u => u.usuario === usuario)) {
    return res.redirect('/new-account.html?erro=usuario-existe');
  }

  const erros = [];
  if (senha.length < 6) erros.push('mínimo 6 caracteres');
  if (!/\d/.test(senha)) erros.push('um número');
  if (!/[A-Z]/.test(senha)) erros.push('uma maiúscula');
  if (erros.length > 0) {
    return res.redirect(`/new-account.html?erro=senha&detalhe=${encodeURIComponent(erros.join(', '))}`);
  }

  if (senha !== senha2) {
    return res.redirect('/new-account.html?erro=senha&detalhe=senhas+não+coincidem');
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const avatar = `/man.jpeg`;
  const novoUsuario = {
    usuario,
    senha: senhaHash,
    nome,
    sobre,
    celular,
    email,
    patrocinador,
    avatar,
    nivel: 1,
    data_cadastro: new Date().toISOString().split('T')[0]
  };

  usuarios.push(novoUsuario);
  salvarUsuarios(usuarios);

  res.redirect('/?cadastro=ok');
});

// Rota: GET /profile-ch.html
app.get('/profile-ch.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile-ch.html'));
});

// Rota: GET /receipts.html
app.get('/receipts.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receipts.html'));
});

// ✅ Rota: GET /admin.html
app.get('/admin.html', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.redirect('/index.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ✅ Rota: GET /api/admin/filas
app.get('/api/admin/filas', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  res.json(lerFila());
});

// ✅ Rota: GET /api/admin/caixa
app.get('/api/admin/caixa', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  res.json(lerCaixa());
});

// ✅ Rota: GET /api/admin/exportar
app.get('/api/admin/exportar', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  let csv = 'ID,Nome,Email,Celular,Nível,Cadastro\n';
  usuarios.forEach(u => {
    csv += `${u.usuario},"${u.nome} ${u.sobre}",${u.email},${u.celular},${u.nivel},${u.data_cadastro}\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', 'attachment; filename=usuarios.csv');
  res.send(csv);
});

// Rota: GET /api/usuario
app.get('/api/usuario', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user) {
    res.json({
      nome: `${user.nome} ${user.sobre}`,
      email: user.email,
      celular: user.celular,
      avatar: user.avatar,
      patrocinador: user.patrocinador,
      usuario: user.usuario,
      nivel: user.nivel
    });
  } else {
    res.status(404).json({ erro: 'Usuário não encontrado' });
  }
});

// Rota: GET /api/giros
app.get('/api/giros', verificaLogin, (req, res) => {
  const giros = lerGiros();
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  const fila = lerFila();
  res.json({
    giros,
    nivelAtual: user?.nivel || 1,
    posicaoNaFila: user ? fila[user.nivel]?.findIndex(u => u.usuario === user.usuario) + 1 : null
  });
});

// Rota: POST /entrar-na-fila
app.post('/api/entrar-na-fila', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  const fila = lerFila();
  const giros = lerGiros();

  if (!user) return res.json({ erro: 'Usuário não encontrado' });

  const nivel = user.nivel;
  const giro = giros.find(g => g.nivel === nivel);

  if (!giro || nivel === 1) {
    return res.json({ erro: 'Nível inválido para fila' });
  }

  if (fila[nivel] && fila[nivel].some(u => u.usuario === user.usuario)) {
    return res.json({ erro: 'Você já está na fila deste nível' });
  }

  if (!fila[nivel]) fila[nivel] = [];
  fila[nivel].push({ usuario: user.usuario, data: new Date().toISOString().split('T')[0] });
  salvarFila(fila);

  res.json({ mensagem: `Você entrou na fila do Giro ${nivel}!` });
});

// Rota: GET /logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/?sucesso=logout');
  });
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});