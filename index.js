import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';

class TrasportiPage extends StatefulWidget {
  const TrasportiPage({super.key});

  @override
  State<TrasportiPage> createState() => _TrasportiPageState();
}

class _TrasportiPageState extends State<TrasportiPage> {
  final TextEditingController _trenoCtrl = TextEditingController();
  Map<String, dynamic>? _trenoData;
  bool _isLoading = false;
  String _statusMessage = "";

  // URL del tuo server Render
  final String _baseUrl = "https://ponte-treni.onrender.com";

  Future<void> _cercaTreno() async {
    final numero = _trenoCtrl.text.trim();
    if (numero.isEmpty) return;

    setState(() {
      _isLoading = true;
      _trenoData = null;
      _statusMessage = "Sveglio il server su Render... attendi circa 1 minuto.";
    });

    try {
      // Costruiamo l'URL completo per la rotta definita nel backend
      final uri = Uri.parse("$_baseUrl/treno/$numero");
      
      // Timeout lunghissimo (100 secondi) per vincere il letargo di Render
      final response = await http.get(uri).timeout(const Duration(seconds: 100));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        
        // Verifichiamo se i dati contengono le info del treno
        if (data != null && data.toString().contains('compNumeroTreno')) {
          setState(() {
            _trenoData = data;
            _isLoading = false;
            _statusMessage = "";
          });
        } else {
          setState(() {
            _statusMessage = "Treno non trovato o dati non disponibili.";
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _statusMessage = "Il server ha risposto con errore: ${response.statusCode}";
          _isLoading = false;
        });
      }
    } on TimeoutException {
      setState(() {
        _statusMessage = "Tempo scaduto. Il server Render è troppo lento a svegliarsi. Riprova ora.";
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _statusMessage = "Errore di connessione. Verifica che il server Render sia 'Live'.";
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A), // Sfondo scuro moderno
      appBar: AppBar(
        title: const Text("INFO TRENO LIVE", style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1E293B),
        centerTitle: true,
        elevation: 4,
      ),
      body: Column(
        children: [
          _buildInputArea(),
          if (_isLoading) const LinearProgressIndicator(color: Colors.amber),
          if (_statusMessage.isNotEmpty) _buildErrorBanner(),
          Expanded(
            child: _trenoData != null ? _buildResults() : _buildEmptyState(),
          ),
        ],
      ),
    );
  }

  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: Color(0xFF1E293B),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(20)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _trenoCtrl,
              style: const TextStyle(color: Colors.white),
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                hintText: "Esempio: 12912",
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
                prefixIcon: const Icon(Icons.train, color: Colors.amber),
                filled: true,
                fillColor: const Color(0xFF334155),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ),
          const SizedBox(width: 10),
          ElevatedButton(
            onPressed: _isLoading ? null : _cercaTreno,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.amber,
              padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Icon(Icons.search, color: Colors.black),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      margin: const EdgeInsets.all(15),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.redAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(10), border: Border.all(color: Colors.redAccent)),
      child: Text(_statusMessage, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildResults() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Card(
        color: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Text("TRENO ${_trenoData!['compNumeroTreno']}", style: const TextStyle(color: Colors.amber, fontSize: 24, fontWeight: FontWeight.bold)),
              const Divider(color: Colors.white10, height: 30),
              _infoRow("Stato", _trenoData!['stazioneUltimoRilevamento'] ?? "In viaggio"),
              _infoRow("Ritardo", "${_trenoData!['ritardo']} min", color: (_trenoData!['ritardo'] ?? 0) > 0 ? Colors.red : Colors.greenAccent),
              _infoRow("Binario", _trenoData!['binarioEffettivoArrivoDescrizione'] ?? "Dati non disp."),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value, {Color color = Colors.white}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white60, fontSize: 16)),
          Text(value, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off, size: 80, color: Colors.white.withOpacity(0.1)),
          const SizedBox(height: 10),
          const Text("Inserisci un numero treno per iniziare", style: TextStyle(color: Colors.white24)),
        ],
      ),
    );
  }
}
