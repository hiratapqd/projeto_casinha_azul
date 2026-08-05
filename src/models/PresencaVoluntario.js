const mongoose = require('mongoose');

const PresencaVoluntarioSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    cpf_voluntario: { type: String, required: true, index: true },
    nome_voluntario: { type: String, required: true },
    data_presenca: { type: Date, required: true, index: true },
    data_registro: { type: Date, default: Date.now },
    origem: { type: String, default: 'formulario' },
    atendimentos_origem: [String]
}, {
    collection: 'presencas_voluntarios'
});

module.exports = mongoose.model('PresencaVoluntario', PresencaVoluntarioSchema);
