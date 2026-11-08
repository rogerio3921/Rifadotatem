<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/rules.php';

$checks = 0;
function check(bool $condition): void
{
    global $checks;
    $checks++;
    if (!$condition) {
        throw new RuntimeException("Check {$checks} failed.");
    }
}
function rejects(callable $operation): void
{
    try {
        $operation();
    } catch (ApiError $error) {
        check($error->httpStatus === 422);
        return;
    }
    throw new RuntimeException('Expected validation rejection.');
}

$campaign = [
    'name' => 'Campanha', 'desc' => '', 'prize' => 'Prêmio', 'price' => 49.99,
    'date' => '2028-02-29', 'count' => 100, 'minimum' => 50, 'cover' => '',
    'id' => 'untrusted', 'priceLocked' => true, 'cancellation' => ['reason' => 'forged'],
];
$clean = campaignFields($campaign);
check($clean['price'] === 49.99);
check(!isset($clean['id'], $clean['priceLocked'], $clean['cancellation']));
foreach ([
    ['date' => '2026-02-29'], ['date' => '2026-04-31'], ['date' => '0000-01-01'],
    ['price' => '50'], ['price' => 0], ['price' => 0.011], ['price' => INF],
    ['price' => NAN], ['price' => 1000000.01], ['count' => 1001],
    ['count' => 1.0], ['count' => true], ['minimum' => -1], ['minimum' => 101],
    ['name' => ''], ['name' => str_repeat('á', 81)], ['desc' => str_repeat('x', 301)],
    ['prize' => []], ['cover' => 'data:image/png;base64,' . base64_encode('not an image')],
] as $changes) {
    rejects(fn() => campaignFields(array_replace($campaign, $changes)));
}
check(cents(0.01) === 1 && cents(1000000) === 100000000 && cents(0.29) === 29);
check(integer(1, 1, 168) === 1);
rejects(fn() => integer('1', 1, 168));
rejects(fn() => text("\xFF", 80));
rejects(fn() => text("name\0", 80));
check(text('  Maria  ', 80) === 'Maria');
check(strlen(passwordValue(str_repeat('x', 12))) === 12);
rejects(fn() => passwordValue(str_repeat('x', 11)));
rejects(fn() => passwordValue(str_repeat('x', 73)));
$image = imagecreatetruecolor(1, 1);
foreach (['png' => 'imagepng', 'jpeg' => 'imagejpeg', 'webp' => 'imagewebp'] as $type => $writer) {
    ob_start();
    $writer($image);
    $uri = 'data:image/' . $type . ';base64,' . base64_encode(ob_get_clean());
    check(validCover($uri) === $uri);
    if ($type === 'png') {
        $png = $uri;
    }
}
unset($image);
rejects(fn() => validCover('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bmQAAAAASUVORK5CYII='));
rejects(fn() => validCover(str_replace('image/png', 'image/jpeg', $png)));
rejects(fn() => validCover('data:image/png;base64,' . str_repeat('A', 700000)));
rejects(fn() => validCover('data:image/svg+xml;base64,' . base64_encode('<svg></svg>')));
rejects(fn() => validCover($png . "\n"));
$settings = defaultBackendSettings();
check(settingsFields($settings) === $settings);
foreach ([
    ['hours' => 0], ['hours' => 169], ['hours' => 1.0], ['phone' => '+5511999999999'],
    ['pixKey' => ''], ['organizer' => ''], ['rules' => ''], ['message' => ''],
    ['rules' => str_repeat('x', 10001)], ['message' => str_repeat('x', 5001)],
    ['pixKey' => str_repeat('x', 201)], ['organizer' => str_repeat('x', 101)],
] as $changes) {
    rejects(fn() => settingsFields(array_replace($settings, $changes)));
}
$reserve = [
    'campaignId' => str_repeat('a', 32), 'numbers' => [10, 2], 'name' => ' Maria ',
    'phone' => '+55 (11) 99999-9999', 'expectedPrice' => 49.99, 'expectedHours' => 24,
    'requestId' => '01234567-89ab-cdef',
];
$clean = reservationFields($reserve);
check($clean['numbers'] === [2, 10] && $clean['phone'] === '5511999999999' && $clean['name'] === 'Maria');
foreach ([
    ['numbers' => [1, 1]], ['numbers' => [1.0]], ['numbers' => ['1']],
    ['numbers' => []], ['numbers' => [0]], ['numbers' => [1001]],
    ['numbers' => ['n' => 1]], ['phone' => '1234'], ['phone' => '1234567890123456'],
    ['phone' => 'text5511999999999'], ['name' => str_repeat('x', 81)],
    ['expectedPrice' => '49.99'], ['expectedHours' => '24'], ['requestId' => 'short'],
    ['requestId' => str_repeat('x', 129)], ['campaignId' => 'pesca'],
] as $changes) {
    rejects(fn() => reservationFields(array_replace($reserve, $changes)));
}
echo "OK: {$checks} backend rule checks\n";
