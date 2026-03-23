import { h, render } from 'https://esm.sh/preact@10.25.4';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.25.4/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);
const Fragment = ({ children }) => children;

export { h, render, html, Fragment, useState, useEffect, useRef, useCallback };
