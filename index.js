import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class TrasportiPage extends StatefulWidget {
  const TrasportiPage({super.key});

  @override
  State<TrasportiPage> createState() => _TrasportiPageState();
}

class _TrasportiPageState extends State<TrasportiPage>
    with SingleTickerProviderStateMixin {
  final TextEditingController _trenoCtrl = TextEditingController();
  Map<String, dynamic>? _trenoData;
  List<dynamic>? _fermate;
  bool _isLoading = false;
  String _status = "Inserisci un numero di treno (es. 9604)";
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  // ── URL del proxy su Render ───────────────────────────────────────────────
  static const String _proxy = 'https://ponte-treni.onrender.com';
  // ─────────────────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
  }

  @override
  void dispose() {
    _animController.dispose();
    _trenoCtrl.dispose();
    super.dispose();
  }

  Future<void> _cercaTreno() async {
    final num = _trenoCtrl.text.trim();
    if (num.isEmpty) return;

    setState(() {
      _isLoading = true;
      _status = "Ricerca in corso...";
      _trenoData = null;
      _fermate = null;
    });
    _animController.reset();

    try {
      // Una sola chiamata al proxy: lui fa i due step internamente
      final uri = Uri.parse('$_proxy/treno/$num');
      final res = await http.get(uri).timeout(const Duration(seconds: 30));

      // Decodifica la risposta — sia successo che errore sono JSON
      dynamic decoded;
      try {
        decoded = json.decode(res.body);
      } catch (_) {
        throw 'Risposta non valida dal server.';
      }

      if (res.statusCode != 200) {
        throw (decoded is Map ? decoded['error'] : null) ??
            'Errore ${res.statusCode}';
      }

      if (decoded is! Map<String, dynamic>) {
        throw 'Formato dati non valido.';
      }

      final data = decoded;

      setState(() {
        _trenoData = data;
        _fermate = data['fermate'] as List<dynamic>?;
        _isLoading = false;
        _status = '';
      });
      _animController.forward();
    } catch (e) {
      setState(() {
        _status = e.toString().replaceAll('Exception:', '').trim();
        if (_status.isEmpty) _status = 'Treno non trovato o non ancora attivo.';
        _isLoading = false;
      });
    }
  }

  String _formatTime(dynamic ms) {
    if (ms == null) return '--:--';
    final dt = DateTime.fromMillisecondsSinceEpoch(ms as int, isUtc: false);
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  Color _ritardoColor(int ritardo) {
    if (ritardo <= 0) return const Color(0xFF4ADE80);
    if (ritardo <= 5) return const Color(0xFFFBBF24);
    return const Color(0xFFF87171);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B1120),
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                  color: Colors.amber, shape: BoxShape.circle),
            ),
            const SizedBox(width: 10),
            const Text('TRAIN TRACKER',
                style: TextStyle(
                    color: Colors.white,
                    letterSpacing: 3,
                    fontWeight: FontWeight.w700,
                    fontSize: 15)),
          ],
        ),
        backgroundColor: const Color(0xFF0F172A),
        elevation: 0,
      ),
      body: Column(
        children: [
          Container(
            color: const Color(0xFF0F172A),
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _trenoCtrl,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(
                        color: Colors.white, fontSize: 18, letterSpacing: 2),
                    decoration: InputDecoration(
                      hintText: 'N° treno  (es. 9604)',
                      hintStyle: const TextStyle(
                          color: Color(0xFF475569), letterSpacing: 1),
                      filled: true,
                      fillColor: const Color(0xFF1E293B),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 16),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    onSubmitted: (_) => _cercaTreno(),
                  ),
                ),
                const SizedBox(width: 12),
                GestureDetector(
                  onTap: _cercaTreno,
                  child: Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: Colors.amber,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.search_rounded,
                        color: Color(0xFF0B1120), size: 26),
                  ),
                ),
              ],
            ),
          ),

          if (_isLoading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E293B),
              valueColor: AlwaysStoppedAnimation<Color>(Colors.amber),
              minHeight: 2,
            ),

          if (_status.isNotEmpty)
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              child: Row(
                children: [
                  Icon(
                    _isLoading
                        ? Icons.sync_rounded
                        : Icons.info_outline_rounded,
                    color: const Color(0xFF64748B),
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_status,
                        style: const TextStyle(
                            color: Color(0xFF94A3B8), fontSize: 14)),
                  ),
                ],
              ),
            ),

          if (_trenoData != null)
            Expanded(
              child: FadeTransition(
                opacity: _fadeAnim,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    _buildHeaderCard(),
                    const SizedBox(height: 16),
                    if (_fermate != null && _fermate!.isNotEmpty)
                      _buildFermateCard(),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildHeaderCard() {
    final ritardo = (_trenoData!['ritardo'] ?? 0) as int;
    final ultimaStaz =
        _trenoData!['stazioneUltimoRilevamento'] as String? ?? '—';
    final categoria = _trenoData!['categoria'] as String? ?? '';
    final dest = _trenoData!['destinazione'] as String? ?? '—';
    final origine = _trenoData!['origine'] as String? ?? '—';
    final provvedimento = _trenoData!['provvedimento'] as int? ?? 0;
    final ritardoCol = _ritardoColor(ritardo);

    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('TRENO ${_trenoCtrl.text}',
                  style: const TextStyle(
                      color: Colors.amber,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2)),
              const Spacer(),
              if (categoria.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(6)),
                  child: Text(categoria,
                      style: const TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 11,
                          letterSpacing: 1)),
                ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(Icons.trip_origin,
                  color: Color(0xFF64748B), size: 14),
              const SizedBox(width: 6),
              Expanded(
                  child: Text('$origine  →  $dest',
                      style: const TextStyle(
                          color: Color(0xFF94A3B8), fontSize: 13))),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(color: Color(0xFF1E293B)),
          const SizedBox(height: 10),
          const Text('ULTIMA POSIZIONE RILEVATA',
              style: TextStyle(
                  color: Color(0xFF475569),
                  fontSize: 10,
                  letterSpacing: 2)),
          const SizedBox(height: 6),
          Text(ultimaStaz,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: ritardoCol.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: ritardoCol.withValues(alpha: 0.3)),
            ),
            child: Column(
              children: [
                Text(
                  ritardo <= 0 ? 'IN ORARIO' : '+$ritardo MIN',
                  style: TextStyle(
                      color: ritardoCol,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2),
                ),
                const SizedBox(height: 2),
                Text(
                  ritardo <= 0 ? 'Nessun ritardo' : 'Ritardo accumulato',
                  style: TextStyle(
                      color: ritardoCol.withValues(alpha: 0.7),
                      fontSize: 12),
                ),
              ],
            ),
          ),
          if (provvedimento != 0) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0x1AF87171),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0x40F87171)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded,
                      color: Color(0xFFF87171), size: 18),
                  const SizedBox(width: 8),
                  Text(
                    provvedimento == 1 ? 'TRENO SOPPRESSO' : 'TRENO DEVIATO',
                    style: const TextStyle(
                        color: Color(0xFFF87171),
                        fontWeight: FontWeight.bold,
                        fontSize: 13),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildFermateCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('FERMATE',
              style: TextStyle(
                  color: Color(0xFF475569),
                  fontSize: 10,
                  letterSpacing: 2)),
          const SizedBox(height: 16),
          ..._fermate!.asMap().entries.map((entry) {
            final f = entry.value as Map<String, dynamic>;
            return _buildFermataRow(f, entry.key, _fermate!.length);
          }),
        ],
      ),
    );
  }

  Widget _buildFermataRow(Map<String, dynamic> f, int index, int total) {
    final nome = f['stazione'] as String? ?? '—';
    final ritardoF = f['ritardo'] as int? ?? 0;
    final partenzaP = _formatTime(f['partenzaProgrammata']);
    final isLast = index == total - 1;
    final bool passata = f['arrivoEffettivo'] != null;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  margin: const EdgeInsets.only(top: 4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: passata ? Colors.amber : const Color(0xFF334155),
                    border: Border.all(
                        color: passata
                            ? Colors.amber
                            : const Color(0xFF475569),
                        width: 2),
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: passata
                          ? Colors.amber.withValues(alpha: 0.3)
                          : const Color(0xFF1E293B),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 18),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(nome,
                            style: TextStyle(
                              color: passata
                                  ? Colors.white
                                  : const Color(0xFF64748B),
                              fontSize: 14,
                              fontWeight: passata
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            )),
                        if (!isLast) ...[
                          const SizedBox(height: 2),
                          Text('Partenza: $partenzaP',
                              style: const TextStyle(
                                  color: Color(0xFF475569),
                                  fontSize: 11)),
                        ],
                      ],
                    ),
                  ),
                  if (ritardoF != 0)
                    Text(
                      ritardoF > 0 ? "+$ritardoF'" : "$ritardoF'",
                      style: TextStyle(
                          color: _ritardoColor(ritardoF),
                          fontSize: 13,
                          fontWeight: FontWeight.bold),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
