const mongoose = require('mongoose');
const livroSchema = new mongoose.Schema({
    _id: { type: String, required: true }, 
    titulo: String,
    autor: String,
    ditadoPor: String,
    categoria: String, 
    preco_custo: Number,
    editora:String,
    preco_venda: Number,
    estoque_atual: Number,
    estoque_minimo: { type: Number, default: 2 },
    data_cadastro: Date
}, { collection: 'livros' }); 

module.exports = mongoose.model('Livro', livroSchema);