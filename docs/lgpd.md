# LGPD — Política de Tratamento de Dados

## Enquadramento legal

O REPBrasil trata dados pessoais de **pessoas públicas no exercício de função pública**,
com base nas seguintes hipóteses legais da Lei nº 13.709/2018 (LGPD):

- **Art. 7º, II**: tratamento necessário para o cumprimento de obrigação legal ou regulatória
- **Art. 7º, III**: tratamento pela administração pública para políticas públicas (base aplicada por analogia para fins de interesse público)
- **Art. 7º, IX**: legítimo interesse do controlador para fins de transparência, prestação de contas e controle social
- **Art. 11, §1º**: dados pessoais tornados manifestamente públicos pelo próprio titular ou pela natureza do cargo

## Finalidade

O tratamento de dados tem finalidade única e específica:

> Organizar, cruzar e apresentar publicamente dados públicos oficiais sobre
> pessoas que exercem ou disputam mandatos públicos, para fins de transparência
> política, controle social e prestação de contas democrática.

Não há finalidade comercial, publicitária ou de perfilagem para fins privados.

## Dados tratados

### O que tratamos

- Dados eleitorais públicos (TSE): candidaturas, resultados, bens declarados, filiação
- Dados legislativos públicos (Câmara, Senado): presença, produção, gastos, emendas
- Dados patrimoniais declarados publicamente
- Dados de processos judiciais públicos (DataJud/CNJ)
- Dados de contratos e compras públicas (PNCP, Portal da Transparência)
- Dados de empresas vinculadas (Receita Federal/CNPJ)

### O que não tratamos

- Dados de vida privada não relacionados ao exercício da função pública
- Dados de saúde
- Dados biométricos
- Dados de familiares que não ocupam função pública
- Dados obtidos de fontes não oficiais

## Princípios aplicados

### Finalidade
Os dados são usados exclusivamente para a finalidade declarada acima.

### Necessidade e minimização
Coletamos apenas o mínimo necessário para cumprir a finalidade. Dados desnecessários
para o perfil público não são armazenados.

### Transparência
- Toda informação exibida possui fonte visível
- A metodologia de cálculo do score é pública
- O código de coleta e processamento é open source

### Segurança
- Dados são armazenados em banco relacional com acesso controlado
- Pipelines de coleta rodam com credenciais de leitura apenas
- Sem armazenamento de senhas ou dados de autenticação de terceiros

## Dados públicos vs. dados pessoais sensíveis

Políticos, candidatos e servidores públicos em cargo de relevância têm **expectativa
reduzida de privacidade** quanto ao exercício de suas funções, conforme reconhecido
pela jurisprudência brasileira e pela própria LGPD (art. 11, §1º).

Os dados tratados pelo REPBrasil são, em sua totalidade:
1. Disponibilizados voluntariamente pelos próprios titulares (declarações de bens)
2. Produzidos no exercício de função pública (votações, emendas, gastos)
3. Publicados em bases governamentais de acesso público

## Direitos dos titulares

Qualquer titular pode:
- **Contestar** dado incorreto pelo processo em [contestacao.md](contestacao.md)
- **Solicitar esclarecimento** sobre como um dado é utilizado
- **Verificar** a fonte de qualquer informação exibida

**Não é possível solicitar exclusão de dados que são registros públicos.**
A exclusão de um dado verdadeiro e público contraria a finalidade do projeto
e a base legal do tratamento.

## Limites do tratamento

O REPBrasil **não**:
- Infere dados não disponíveis publicamente
- Cruza dados públicos com dados privados
- Atribui características pessoais não documentadas
- Faz perfilagem preditiva ou comportamental
- Compartilha dados com terceiros para fins comerciais
