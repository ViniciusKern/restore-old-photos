import { render, screen } from "@testing-library/react";
import { FlowHeader } from "@/app/_components/restore/flow-header";

test.each([
  ["select", 1, "Checkout"], ["camera", 1, "Checkout"], ["crop", 2, "Checkout"], ["checkout", 3, "Checkout"], ["result", 3, "Result"],
] as const)("shows progress for %s without a restore CTA", (step, number, finalLabel) => {
  render(<FlowHeader step={step} />);
  expect(screen.getByLabelText(`Step ${number} of 3`)).toHaveTextContent(finalLabel);
  expect(screen.getByRole("link", { name: "Back to Restore Old Photos home" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Restore a photo" })).not.toBeInTheDocument();
});
