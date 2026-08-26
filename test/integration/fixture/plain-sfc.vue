<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
    <p class="plain-sfc">{{ label }}</p>
</template>
