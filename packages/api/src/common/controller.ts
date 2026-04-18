import { Hono } from "hono";

export interface IFactory {
  createApp(): Hono;
}

export type IController<TApp extends Hono<any, any, any> = Hono<any, any, any>> = {
  build: (factory: IFactory) => TApp;
};

export function createController<const TApp extends Hono<any, any, any>>(
  controller: IController<TApp>,
): IController<TApp> {
  return controller;
}
