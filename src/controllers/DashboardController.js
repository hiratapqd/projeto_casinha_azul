const Atendimento = require('../models/Atendimento');
const Voluntario = require('../models/Voluntario');

function normalizarCpf(cpf = '') {
    return String(cpf).replace(/\D/g, '');
}

function normalizarTipo(tipo = '') {
    return String(tipo).trim().toLowerCase();
}

function formatarPercentualTruncado(valor, total) {
    if (!total) return '0.00';

    const percentual = (valor / total) * 100;
    return (Math.floor(percentual * 100) / 100).toFixed(2);
}

// --- FUNÇÃO AUXILIAR PARA PEGAR DATA EM GMT-3 ---
const getDataBrasilia = () => {
    const agora = new Date();
    const brasiliaTime = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
    return brasiliaTime;
};

// --- FUNÇÕES AUXILIARES DE CÁLCULO ---
const calcularEquipeAtiva = (voluntarios, mapa) => {
    const contagemResumo = {};
    Object.keys(mapa).forEach(label => {
        const chaves = mapa[label];
        const encontrados = voluntarios.filter(v => {
            const disp = v.disponibilidade || {};
            return chaves.some(chave => {
                const campo = disp[chave];
                return (Array.isArray(campo) && campo.length > 0);
            });
        });
        contagemResumo[label] = encontrados.length;
    });
    return contagemResumo;
};

const calcularEscalaHoje = (voluntarios, mapa) => {
    // Usamos a função de fuso horário que você já tem para garantir a data correta do Brasil
    const hojeBrasilia = getDataBrasilia(); 
    
    const hojeAbrev = hojeBrasilia.toLocaleDateString('pt-BR', { weekday: 'short' })
                                .toLowerCase()
                                .replace('.', '') 
                                .substring(0, 3); 

    const escala = [];
    voluntarios.forEach(v => {
        const disp = v.disponibilidade || {};
        Object.entries(mapa).forEach(([label, chaves]) => {
            chaves.forEach(chave => {
                const diasMarcados = disp[chave] || [];
                if (Array.isArray(diasMarcados) && diasMarcados.includes(hojeAbrev)) {
                    escala.push({ nome: v.nome, tipo: label });
                }
            });
        });
    });
    return escala;
};

const calcularAbandonoApometria = async () => {
    const historico = await Atendimento.find(
        { cpf_assistido: { $exists: true, $nin: [null, ''] } },
        { cpf_assistido: 1, tipo: 1, data: 1 }
    ).lean();

    const historicosPorCpf = new Map();

    historico.forEach((atendimento) => {
        const cpf = normalizarCpf(atendimento.cpf_assistido);
        const tipo = normalizarTipo(atendimento.tipo);
        const data = new Date(atendimento.data);

        if (!cpf || !tipo || Number.isNaN(data.getTime())) return;

        if (!historicosPorCpf.has(cpf)) {
            historicosPorCpf.set(cpf, []);
        }

        historicosPorCpf.get(cpf).push({ tipo, data });
    });

    let totalComApometria = 0;
    let totalAbandonos = 0;

    historicosPorCpf.forEach((atendimentos) => {
        atendimentos.sort((a, b) => a.data - b.data);

        const indiceUltimaApometria = atendimentos
            .map((atendimento) => atendimento.tipo)
            .lastIndexOf('apometria');

        if (indiceUltimaApometria === -1) return;

        totalComApometria++;

        const dataUltimaApometria = atendimentos[indiceUltimaApometria].data.getTime();
        const atendimentosDesdeUltimaApometria = atendimentos.filter((atendimento) => {
            return atendimento.data.getTime() >= dataUltimaApometria;
        });

        const temPasseNoCiclo = atendimentosDesdeUltimaApometria.some((atendimento) => {
            return atendimento.tipo === 'passe';
        });

        const teveOutroAtendimentoDepois = atendimentosDesdeUltimaApometria.some((atendimento) => {
            return atendimento.tipo !== 'apometria' && atendimento.tipo !== 'passe';
        });

        if (temPasseNoCiclo && !teveOutroAtendimentoDepois) {
            totalAbandonos++;
        }
    });

    return {
        totalBase: totalComApometria,
        totalAbandonos,
        taxaAbandono: formatarPercentualTruncado(totalAbandonos, totalComApometria)
    };
};

exports.getDashboard = async (req, res) => {
    try {
        const hojeBrasilia = getDataBrasilia();
        
        const hojeInicio = new Date(hojeBrasilia);
        hojeInicio.setUTCHours(0, 0, 0, 0);
        
        const hojeFim = new Date(hojeBrasilia);
        hojeFim.setUTCHours(23, 59, 59, 999);

        // 1. Buscas no Banco (Campo 'data' conforme o print)
        const [totalAtendimentosHoje, voluntariosDB] = await Promise.all([
            Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim } }),
            Voluntario.find({ esta_ativo: { $ne: "Não" } }).lean()
        ]);
        const [atendimentosPorTipoDB] = await Promise.all([
            Atendimento.aggregate([
                {
                    $match: {
                        data: { $gte: hojeInicio, $lte: hojeFim }
                    }
                },
                {
                    $group: {
                        _id: "$tipo",
                        total: { $sum: 1 }
                    }
                }
            ]),
            Voluntario.find({ esta_ativo: { $ne: "Não" } }).lean()
        ]);

        const atendimentosHoje = {
            apometria: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'apometria' }),
            reiki: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'reiki' }),
            auriculo: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'auriculo' }),
            maos: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'maos_sem_fronteiras' }),
            homeopatia: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'homeopatia' }),
            passe: await Atendimento.countDocuments({ data: { $gte: hojeInicio, $lte: hojeFim }, tipo: 'passe' })
        };
                atendimentosPorTipoDB.forEach(item => {
            if (atendimentosHoje.hasOwnProperty(item._id)) {
                atendimentosHoje[item._id] = item.total;
            }
        });
        // Taxa de abandono: assistidos com apometria + passe e nenhum retorno posterior.
        const abandonoApometria = await calcularAbandonoApometria();

        // 3. Mapeamento Geral
        const mapaGeral = {
            "Apometria": ["apometria"],
            "Reiki": ["reiki"],
            "Aurículo": ["auriculo"],
            "Mãos sem Fronteiras": ["maos"],
            "Homeopatia": ["homeopatia"],
            "Passe": ["passe"],
            "Cantina": ["cantina"],
            "Mesa": ["mesa"]
        };

        const voluntariosPorTipo = calcularEquipeAtiva(voluntariosDB, mapaGeral);
        const escala_hoje = calcularEscalaHoje(voluntariosDB, mapaGeral);

        res.render('index', {
            resumo: {
                hoje: totalAtendimentosHoje,
                taxaAbandono: abandonoApometria.taxaAbandono,
                apometriaUnica: abandonoApometria.totalAbandonos,
                totalBaseApometria: abandonoApometria.totalBase,
                detalheAtendimentos: atendimentosHoje,
                voluntariosPorTipo,
                totalVoluntarios: voluntariosDB.length
            },
            escala_hoje
        });

    } catch (err) {
        console.error("Erro no Dashboard:", err);
        res.status(500).send("Erro ao carregar dashboard.");
    }
};
