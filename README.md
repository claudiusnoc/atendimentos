# Relatório de Atendimentos

Projeto novo, localizado dentro da pasta que preserva as planilhas fonte.

## Executar localmente

Use um ambiente Python com `openpyxl` e execute:

```powershell
python server.py
```

Abra `http://127.0.0.1:8080`.

## Fonte atual

`../Tipologia e Indicadores.xlsx` é lida pelo adaptador local. Ao digitar a instalação em uma linha, a aplicação preenche prioridade, quantidade de instalações, base técnica e técnicos de energia da aba `Tipologia`.

`../Atendimentos.xlsx` é a fonte da grade inicial e das listas suspensas de Técnico, Falha e Status. O arquivo precisa estar fechado no Excel quando o servidor for iniciado para que essas listas e as linhas existentes possam ser importadas. Durante a edição, a lista fica armazenada no navegador nesta etapa.

## Supabase

O projeto Supabase `ATENDIMENTOS` já existe e a primeira execução do SQL foi confirmada no painel. `supabase/schema.sql` é reexecutável e acrescenta prioridade e quantidade à tabela de atendimentos para que os campos continuem editáveis. Execute a versão atualizada desse arquivo no SQL Editor antes de testar a gravação.

O navegador agora exige autenticação, consulta `tipologia_sites` para sugerir estações e salva o relatório em `atendimentos`. A sessão é mantida pelo cliente Supabase e as linhas também ficam em cache local do navegador. A lista é recarregada periodicamente para refletir alterações feitas em outro dispositivo.

O catálogo ainda precisa ser importado: carregue somente as linhas da aba `Tipologia`, preservando todos os campos originais em `dados` e usando as colunas `site`, `priority` e `quantity` para busca. Sem essa importação, login poderá funcionar, mas a busca de estações e a gravação de atendimentos não estarão prontas.

`supabase-config.js` contém somente a URL e a chave publicável do projeto. A chave publicável pode estar no navegador; as políticas RLS limitam as tabelas ao papel autenticado. Nunca adicione uma chave `secret` ou `service_role` ao código ou ao repositório.

O modo local com `server.py` continua disponível para consultar as planilhas fonte. O diretório ainda não está inicializado como repositório Git e nenhum repositório foi publicado.
