# Launched games

Games built from this template and deployed to the arcade. The template's
committed default stays on Snake; entries here are independent apps shipped from
the template with their own GCS contract and `.dot` domain.

## Flappy Bird

- **Name:** Flappy Bird
- **Component:** `src/games/flappy-bird/FlappyBird.tsx` (+ `flappy-bird.css`)
- **Score semantics:** points, higher-is-better (`scoreOrdering: 0`,
  `scoreFormat: 0`, `scoreUnit: ""`) — one point per pipe passed.
- **Domain / play URL:** `arcade-flappy` → https://arcade-flappy.dot.li
- **GCS contract address:** `0xd276c6301da46d1e1a29cc5ec774f1f19ba0f91b`
- **Registry:** `0x4d1891947e2d25eda37005b476c67fb007003cc2`
  (target `b7a87bf51613d89f`, Paseo Asset Hub next)
- **Owner / signer:** `//Alice`
  (h160 `0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20`)
- **Thumbnail CID:** `bafkreierhubxebvyr5vzzvhg3tl6su762laopokeuuuinpn32qli72quyy`
- **App CID:** `bafybeidxjttuzulful3jm47csmlns3x744okempuxiikkgrqsdyn4l4nkm`
- **Dashboard:** https://arcade.dot.li/game/0xd276c6301da46d1e1a29cc5ec774f1f19ba0f91b
- **Verify:** `arcadeVersion() == 1`, listing present, metadata matches.
