const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const Atendimento = require('../src/models/Atendimento');
const Voluntario = require('../src/models/Voluntario');
const PresencaVoluntario = require('../src/models/PresencaVoluntario');

const DEFAULT_BATCH_SIZE = 500;
const TIME_ZONE = 'America/Sao_Paulo';

function parseArgs(argv) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--batch-size' || arg === '-b') {
      options.batchSize = Number(argv[index + 1]);
      index += 1;
    }
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('O valor de --batch-size deve ser um inteiro positivo.');
  }

  return options;
}

function normalizarCpf(valor = '') {
  return String(valor).replace(/\D/g, '');
}

function normalizarNome(valor = '') {
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function obterDataLocalIso(data) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

function criarDataInicioDia(dataIso) {
  return new Date(`${dataIso}T00:00:00-03:00`);
}

function montarMapasVoluntarios(voluntarios) {
  const porCpf = new Map();
  const porNome = new Map();

  voluntarios.forEach((voluntario) => {
    const cpf = normalizarCpf(voluntario._id);
    const nomeNormalizado = normalizarNome(voluntario.nome);

    if (cpf.length === 11) {
      porCpf.set(cpf, { ...voluntario, cpf });
    }

    if (nomeNormalizado) {
      const lista = porNome.get(nomeNormalizado) || [];
      lista.push({ ...voluntario, cpf });
      porNome.set(nomeNormalizado, lista);
    }
  });

  return { porCpf, porNome };
}

function encontrarVoluntario(valorAtendimento, mapas) {
  const cpf = normalizarCpf(valorAtendimento);

  if (cpf.length === 11 && mapas.porCpf.has(cpf)) {
    return { status: 'ok', voluntario: mapas.porCpf.get(cpf) };
  }

  const nomeNormalizado = normalizarNome(valorAtendimento);
  const candidatos = mapas.porNome.get(nomeNormalizado) || [];

  if (candidatos.length === 1) {
    return { status: 'ok', voluntario: candidatos[0] };
  }

  if (candidatos.length > 1) {
    return { status: 'ambiguo' };
  }

  return { status: 'nao_encontrado' };
}

function adicionarAmostra(lista, item, limite = 20) {
  if (lista.length < limite) {
    lista.push(item);
  }
}

async function executarEmLotes(operacoes, batchSize) {
  let processadas = 0;
  let inseridas = 0;
  let modificadas = 0;

  for (let index = 0; index < operacoes.length; index += batchSize) {
    const lote = operacoes.slice(index, index + batchSize);
    const resultado = await PresencaVoluntario.bulkWrite(lote, { ordered: false });

    processadas += lote.length;
    inseridas += resultado.upsertedCount || 0;
    modificadas += resultado.modifiedCount || 0;
    console.log(`Lote processado: ${processadas}/${operacoes.length}`);
  }

  return { inseridas, modificadas };
}

async function main() {
  const { batchSize, dryRun } = parseArgs(process.argv.slice(2));

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI nao encontrado no .env.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB conectado.');

  try {
    const [voluntarios, atendimentos] = await Promise.all([
      Voluntario.find({}).lean(),
      Atendimento.find({
        voluntario: { $exists: true, $nin: [null, ''] },
        data: { $exists: true, $ne: null },
      })
        .select('_id data voluntario')
        .lean(),
    ]);

    const mapas = montarMapasVoluntarios(voluntarios);
    const presencasPorId = new Map();
    const resumo = {
      atendimentosLidos: atendimentos.length,
      presencasGeradas: 0,
      semData: 0,
      voluntarioNaoEncontrado: 0,
      voluntarioAmbiguo: 0,
      cpfVoluntarioInvalido: 0,
      amostrasNaoEncontrados: [],
      amostrasAmbiguos: [],
      amostrasCpfInvalido: [],
    };

    atendimentos.forEach((atendimento) => {
      const dataAtendimento = new Date(atendimento.data);

      if (Number.isNaN(dataAtendimento.getTime())) {
        resumo.semData += 1;
        return;
      }

      const resultadoBusca = encontrarVoluntario(atendimento.voluntario, mapas);

      if (resultadoBusca.status === 'nao_encontrado') {
        resumo.voluntarioNaoEncontrado += 1;
        adicionarAmostra(resumo.amostrasNaoEncontrados, atendimento.voluntario);
        return;
      }

      if (resultadoBusca.status === 'ambiguo') {
        resumo.voluntarioAmbiguo += 1;
        adicionarAmostra(resumo.amostrasAmbiguos, atendimento.voluntario);
        return;
      }

      const voluntario = resultadoBusca.voluntario;
      const cpfVoluntario = normalizarCpf(voluntario.cpf || voluntario._id);

      if (cpfVoluntario.length !== 11) {
        resumo.cpfVoluntarioInvalido += 1;
        adicionarAmostra(resumo.amostrasCpfInvalido, voluntario.nome || voluntario._id);
        return;
      }

      const dataIso = obterDataLocalIso(dataAtendimento);
      const idPresenca = `${cpfVoluntario}_${dataIso}`;
      const existente = presencasPorId.get(idPresenca);

      if (existente) {
        existente.atendimentos_origem.push(String(atendimento._id));
        if (dataAtendimento < existente.data_registro) {
          existente.data_registro = dataAtendimento;
        }
        return;
      }

      presencasPorId.set(idPresenca, {
        _id: idPresenca,
        cpf_voluntario: cpfVoluntario,
        nome_voluntario: voluntario.nome,
        data_presenca: criarDataInicioDia(dataIso),
        data_registro: dataAtendimento,
        origem: 'atendimentos',
        atendimentos_origem: [String(atendimento._id)],
      });
    });

    const presencas = Array.from(presencasPorId.values());
    resumo.presencasGeradas = presencas.length;

    console.log('Resumo da leitura:');
    console.log(JSON.stringify(resumo, null, 2));

    if (dryRun) {
      console.log('Dry-run ativo. Nenhuma presenca foi gravada.');
      if (presencas[0]) {
        console.log('Primeira presenca gerada:', JSON.stringify(presencas[0], null, 2));
      }
      return;
    }

    const operacoes = presencas.map((presenca) => ({
      updateOne: {
        filter: { _id: presenca._id },
        update: {
          $setOnInsert: {
            cpf_voluntario: presenca.cpf_voluntario,
            nome_voluntario: presenca.nome_voluntario,
            data_presenca: presenca.data_presenca,
            data_registro: presenca.data_registro,
            origem: presenca.origem,
          },
          $addToSet: {
            atendimentos_origem: { $each: presenca.atendimentos_origem },
          },
        },
        upsert: true,
      },
    }));

    const resultado = await executarEmLotes(operacoes, batchSize);
    console.log(`Importacao concluida. Inseridas: ${resultado.inseridas}. Atualizadas: ${resultado.modificadas}.`);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB desconectado.');
  }
}

main().catch(async (error) => {
  console.error('Erro na importacao de presencas:', error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
