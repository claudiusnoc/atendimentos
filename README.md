# Relatório de Atendimentos

Projeto novo, localizado dentro da pasta que preserva as planilhas fonte.

## Sincronização entre dispositivos — 02/10/2026

No modo Supabase, a fonte do relatório é a tabela `atendimentos`, não a cópia antiga do navegador. O sistema consulta alterações a cada 5 segundos enquanto a página está visível e ao voltar para a aba. O botão **Sincronizar** permite nova tentativa manual.

Somente campos efetivamente editados são enviados. `cloud-sync.js` compara a versão lida com `updated_at` antes de atualizar ou excluir. Alterações em campos diferentes são combinadas; edições concorrentes no mesmo campo exibem **Resolver conflito**, sem sobrescrever automaticamente. Isso depende do gatilho `touch_atendimento` de `supabase/schema.sql`.

O indicador distingue pendente, salvo na nuvem e erro. Rascunhos não enviados ficam separados por usuário e aba, sobrevivem à recarga da mesma aba e são reenviados com verificação de conflito. O cache da versão antiga é preservado, mas nunca reenviado em bloco. Ao migrar, exporte qualquer edição ainda não salva na versão antiga antes de recarregar. Recarregue todas as abas antigas para que deixem de executar o salvamento anterior.

Verificação executada: 16 testes automatizados de concorrência/agendamento; teste autenticado real de inclusão, leitura independente, atualização, conflito e exclusão de uma linha temporária. As sete linhas originais e seus timestamps permaneceram intactos. Nenhuma chave administrativa foi adicionada.

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

O modo local com `server.py` continua disponível para consultar as planilhas fonte. O código está publicado em [claudiusnoc/atendimentos](https://github.com/claudiusnoc/atendimentos). A publicação web pelo GitHub Pages depende de habilitar o Pages nas configurações do repositório e concluir a primeira execução do fluxo de deploy.
