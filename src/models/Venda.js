const mongoose = require('mongoose');

const vendaSchema = new mongoose.Schema({
    livro_id: { type: String, ref: 'Livro', required: true }, // ISBN
    titulo_livro: String,
    quantidade: { type: Number, required: true },
    valor_unitario: Number,
    valor_total: Number,
    forma_pagamento: String,
    data_venda: { type: Date, default: Date.now }
}, { 
    collection: 'vendas',
    versionKey: false 
});

module.exports = mongoose.model('Venda', vendaSchema);
