#!/usr/bin/env node

import nsblob from 'nsblob';

import { main } from '.';

main().then(() => nsblob.socket.close());
