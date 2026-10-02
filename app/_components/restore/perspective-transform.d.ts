declare module "perspective-transform" {
  export default function perspective(
    source: number[],
    destination: number[],
  ): {
    transformInverse(x: number, y: number): [number, number];
  };
}
