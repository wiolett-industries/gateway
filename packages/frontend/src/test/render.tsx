import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

interface RenderWithRouterOptions {
  path?: string;
  route?: string;
  extraRoutes?: ReactNode;
}

export function renderWithRouter(
  element: ReactElement,
  { path = "*", route = "/", extraRoutes }: RenderWithRouterOptions = {}
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={element} />
        {extraRoutes}
      </Routes>
    </MemoryRouter>
  );
}
