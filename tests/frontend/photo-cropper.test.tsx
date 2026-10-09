import { fireEvent, render, screen } from "@testing-library/react";
import { PhotoCropper, type CropQuad } from "@/app/_components/restore/photo-cropper";

const quad: CropQuad = { topLeft: { x: .1, y: .1 }, topRight: { x: .9, y: .1 }, bottomRight: { x: .9, y: .9 }, bottomLeft: { x: .1, y: .9 } };

function setup(isRotating = false) {
  const onCropChange = jest.fn();
  const view = render(<PhotoCropper imageSrc="/photo-before.png" cropQuad={quad} onCropChange={onCropChange} isRotating={isRotating} />);
  const frame = screen.getByRole("img", { name: "Selected photo" }).parentElement!;
  jest.spyOn(frame, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100, toJSON: () => ({}) });
  return { ...view, frame, onCropChange };
}

test("renders eight named crop handles and the selected image", () => {
  setup();
  expect(screen.getAllByRole("button")).toHaveLength(8);
  expect(screen.getByRole("button", { name: "Move top left crop corner" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Move bottom crop edge" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Selected photo" })).toHaveAttribute("src", "/photo-before.png");
});

test("dragging a corner changes that corner without mutating the original quad", () => {
  const { onCropChange } = setup();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move top left crop corner" }), { pointerId: 1, clientX: 25, clientY: 30 });
  expect(onCropChange).toHaveBeenCalledWith({ ...quad, topLeft: { x: .25, y: .3 } });
  expect(quad.topLeft).toEqual({ x: .1, y: .1 });
});

test("moving an edge updates both corners and clamps to the image", () => {
  const { frame, onCropChange } = setup();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move top crop edge" }), { pointerId: 1, clientX: 50, clientY: 20 });
  expect(onCropChange).toHaveBeenLastCalledWith({ ...quad, topLeft: { x: .1, y: .2 }, topRight: { x: .9, y: .2 } });
  fireEvent.pointerMove(frame, { pointerId: 1, clientX: 50, clientY: -30 });
  expect(onCropChange).toHaveBeenLastCalledWith({ ...quad, topLeft: { x: .1, y: 0 }, topRight: { x: .9, y: 0 } });
  fireEvent.pointerUp(frame);
  onCropChange.mockClear();
  fireEvent.pointerMove(frame, { clientX: 50, clientY: 40 });
  expect(onCropChange).not.toHaveBeenCalled();
});

test("does not change crop during rotation", () => {
  const { onCropChange } = setup(true);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move top left crop corner" }), { clientX: 40, clientY: 40 });
  expect(onCropChange).not.toHaveBeenCalled();
});
