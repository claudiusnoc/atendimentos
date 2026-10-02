// Browser-safe configuration. This is a publishable key, never a secret key.
// Access to operational data is enforced by the database's authenticated RLS policies.
window.ATENDIMENTOS_SUPABASE = {
  url: "https://hwedtszilklnupbkwiwj.supabase.co",
  key: "sb_publishable__NHK_CS6qEIc1t23Mo_Z8Q_a9PJOvJz",
};

// These choices come from the validation lists in Atendimentos.xlsx, not from
// additional Tipologia tabs. Technician names remain editable as free text.
window.ATENDIMENTOS_OPTIONS = {
  technicians: [
    "ADRIANO", "ALAN", "ANDERSON", "ANTONIO", "APOIO BH", "APOIO NORTE/LESTE",
    "APOIO OESTE", "APOIO SUL", "APOIO ZM", "BRUNO", "CLAUDIO", "CLEYTON",
    "CRISTOVAM", "DENILSON", "FERNANDO", "FLAVIO", "GLEICIANO", "HAMILTON",
    "ISAC LIMA", "JOSE HORTA", "JULIANO", "LAERCIO", "MARCELO", "MARCIO",
    "MAX CLEI", "REINALDO", "ROBERTO", "SERESAMA DA MATA", "SIDNEY", "TAUA", "WASHINGTON",
  ],
  technicianBases: {
    ADRIANO: "OLI", ALAN: "CVL", ANTONIO: "LGP", BRUNO: "JML", CLAUDIO: "DIV",
    CLEYTON: "LGP", CRISTOVAM: "ITB", DENILSON: "PNV", FLAVIO: "BH", GLEICIANO: "SLG",
    HAMILTON: "CLF", ISACLIMA: "DIV", JOSEHORTA: "MRN", JULIANO: "SLG", LAERCIO: "PNV",
    MARCELO: "DIV", MARCIO: "DIV", REINALDO: "BH", ROBERTO: "CLF", SIDNEY: "DIV",
    WASHINGTON: "JML", FERNANDO: "CLF", APOIOBH: "BH", TAUA: "SER",
    APOIONORTELESTE: "MCL", ANDERSON: "MRN", MAXCLEI: "ITB",
  },
  failures: [
    "FALHA DE DISJUNTOR", "GMG OPERANDO", "FALHA NO GMG", "ALTA TEMPERATURA",
    "TROCAR DE CALOR", "INOPERANTE", "BAIXO NÍVEL COMBUSTÍVEL",
    "BATERRY CURRENT OUT OF RANGE", "FALHA INVERSOR", "FALHA DE AC", "BATERIA EM DESCARGA",
  ],
  statuses: ["ACIONADO", "EM DESLOCAMENTO", "GMG ACOPLADO", "MONITORANDO", "INDISP. TÉCNICA", "SEM ACESSO"],
};
