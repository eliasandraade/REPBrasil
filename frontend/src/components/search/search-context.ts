"use client";

import { createContext, useContext } from "react";

/** Abre a busca global (o diálogo mora no AppShell). Módulo leve: quem só abre a busca não carrega o componente. */
export const SearchDialogContext = createContext<() => void>(() => {});

export const useOpenSearch = () => useContext(SearchDialogContext);
