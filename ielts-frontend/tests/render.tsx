import { render, type RenderOptions } from "@testing-library/react";
import { Providers } from "@/app/providers";

/** render() inside the app's providers (a fresh QueryClient per call). */
export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}
