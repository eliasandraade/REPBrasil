"use client";

import { useState } from "react";
import { Drawer } from "./Dialog";

/** Conteúdo de "Como funciona a apuração?" (seções 88 e 89): factual, sem linguagem partidária. */
export function MethodologyContent() {
  return (
    <div className="space-y-5 text-body-sm leading-relaxed text-fg-soft" data-testid="live-methodology">
      <section>
        <h3 className="text-body-md font-semibold text-fg">De onde vêm os dados</h3>
        <p>
          Todos os números desta página vêm dos arquivos oficiais de divulgação de resultados do Tribunal Superior Eleitoral (TSE), em
          resultados.tse.jus.br. O REPBrasil lê esses arquivos uma vez para todos os visitantes, guarda cada versão recebida e repassa as
          atualizações à página. O seu navegador não consulta o TSE diretamente.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Votos válidos</h3>
        <p>
          No segundo turno, é eleito quem obtém a maioria dos votos válidos. Votos válidos são os dados a uma candidatura. Votos brancos e
          nulos não entram nos votos válidos — por isso os percentuais das candidaturas somam 100% sem eles.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Brancos e nulos</h3>
        <p>
          São contados e publicados pelo TSE, mas não são atribuídos a nenhuma candidatura. Nulos técnicos são votos anulados por motivo
          técnico registrado na totalização.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Seções totalizadas</h3>
        <p>
          Cada seção eleitoral gera um boletim de urna. Quando o boletim é recebido e processado, a seção passa a ser “totalizada”. O
          percentual de seções totalizadas mostra quanto da apuração já entrou na soma oficial; perto de 100%, a página mostra mais casas
          decimais para não esconder o que ainda falta.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Parcial e final</h3>
        <p>
          Enquanto há seções não totalizadas, o resultado é parcial: os números mudam a cada atualização. A totalização final é o ato em que
          a Justiça Eleitoral encerra a totalização e registra a situação de cada candidatura. Só então a página mostra “Resultado final”.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Definição matemática</h3>
        <p>
          O TSE sinaliza nos arquivos (campo md = “e”) quando os votos já totalizados tornam impossível a mudança da liderança, mesmo antes
          de 100% das seções. É esse sinal oficial que faz a página exibir “Eleição matematicamente definida”. Definição matemática não é
          totalização final: a apuração continua e a totalização final vem depois.
        </p>
        <p className="mt-2">
          O REPBrasil também faz uma verificação independente e conservadora — compara a vantagem atual com o número máximo de eleitores
          que ainda podem aparecer (seções não totalizadas e não apuradas), supondo o pior caso para quem está à frente. Essa verificação é
          técnica e nunca substitui o sinal oficial.
        </p>
      </section>
      <section>
        <h3 className="text-body-md font-semibold text-fg">Atualização dos dados</h3>
        <p>
          A página recebe as atualizações automaticamente. O horário da totalização é o do TSE (Brasília); o horário de recebimento é o
          do REPBrasil. Se a fonte demorar a atualizar, a página mantém a última versão oficial recebida e avisa há quanto tempo não há
          novidade. Velocidade e estimativa de conclusão são estatísticas operacionais, nunca previsão de resultado.
        </p>
      </section>
    </div>
  );
}

/** Botão + gaveta "Como funciona a apuração?". */
export function MethodologyButton({ className = "" }: Readonly<{ className?: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`focus-ring rounded-lg border border-line bg-surface px-3 py-1.5 text-body-sm font-medium text-fg-soft hover:bg-subtle ${className}`}
      >
        Como funciona a apuração?
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Como funciona a apuração?" testId="live-methodology-drawer">
        <MethodologyContent />
      </Drawer>
    </>
  );
}
