const Assistido = require('../models/Assistido');

exports.criarAssistido = async (req, res) => {
    try {
        const { cpf, nome, telefone, email } = req.body;

        // 1. Verifica se o assistido já existe (usando o CPF como _id)
        const assistidoExistente = await Assistido.findById(cpf);

        if (assistidoExistente) {
            return res.json({ 
                status: 'existente', 
                nome: assistidoExistente.nome 
            });
        }

        // 2. Prepara os dados conforme o seu esquema original
        const novoAssistido = new Assistido({
            _id: cpf, 
            nome: nome,
            telefone: telefone,
            email: email,
            data_cadastro: new Date().toISOString().split('T')[0]
        });

        // 3. Salva no banco de dados casinha_azul
        await novoAssistido.save();
        
        res.json({ status: 'sucesso' });

    } catch (err) {
        console.error("❌ Erro ao cadastrar assistido:", err);
        res.status(500).json({ 
            status: 'erro', 
            mensagem: 'Erro interno ao processar cadastro.' 
        });
    }
};

// Rota para renderizar a página de formulário
exports.renderFormCadastro = (req, res) => {
    res.render('cadastro_assistidos');
};