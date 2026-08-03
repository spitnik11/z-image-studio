# Z-Image Studio: Simple UGC Workflow

This is the short version of the complete character, dataset, LoRA, generation, and publishing
workflow. Use the detailed vault UGC workflow when troubleshooting or comparing training versions.

## Workflow

```text
Reference image
→ Character profile
→ Test dataset
→ Review
→ Full dataset
→ Train character LoRA
→ Combine LoRA + pose + UGC style
→ Generate and finish
→ Publish or deliver
```

## 1. Choose a master image

Use a clear image of one adult character:

- Face is sharp and unobstructed.
- Lighting is natural or neutral.
- Waist-up or three-quarter framing is ideal.
- Avoid filters, sunglasses, watermarks, blur, groups, and extreme angles.
- Use only a fictional adult or a real adult who gave permission.

## 2. Save the Character

Open **Photo → Character → New character**.

Add:

- Character name
- Unique trigger token, such as `maya_ugc_person`
- Stable face, hair, eyes, skin, and body description
- Preferred Z-Image or Krea model
- Master reference

Start identity/reference weight around `0.70`.

## 3. Generate a 12-image test dataset

Open **Dataset** and select the Character.

- Choose the same model family you plan to train.
- Select **12 · test**.
- Use **Flexible character** captions.
- Keep the description focused on stable identity.
- Generate the test.

If the character drifts badly, improve the reference or description before generating 40 images.

## 4. Review the test

Check every image:

- **Keep** — correct identity, useful angle, acceptable anatomy.
- **Unsure** — save it, but do not train with it yet.
- **Remove from training** — reversible exclusion.
- **Delete image** — permanent removal.

Use **Select all** with the active filter for fast bulk approval or removal. Quality is more
important than image count.

## 5. Build the full dataset

When the test looks good:

- Generate or extend to **40 images**.
- Include headshots, medium shots, seated poses, movement, product interaction, and full-body shots.
- Include several angles, expressions, environments, outfits, and lighting conditions.
- Keep the identity and hairstyle stable.

Extensions continue through the 40-shot variety plan instead of restarting at the first pose.

## 6. Review and caption the full dataset

- Keep roughly 30–40 strong, varied images.
- Remove identity drift, duplicates, blur, bad anatomy, and watermarks.
- Confirm every kept caption includes the trigger token.
- Describe what changes: pose, expression, outfit, scene, angle, and lighting.

Example:

```text
photo of maya_ugc_person, smiling, waist-up view, casual white shirt,
modern kitchen, natural window light
```

## 7. Train the Character LoRA

Choose **Train a LoRA with this dataset**.

- Train Z-Image datasets as Z-Image LoRAs.
- Train Krea datasets as Krea 2 LoRAs.
- Never mix LoRAs between model architectures.
- Use **Quick** first on the 12 GB GPU: 512px, 250 steps, rank 8.
- Use Balanced after the dataset and trigger are proven.
- Run only one training job and avoid generation during training.

When complete, choose **Use in Photo mode**.

## 8. Build a simple multi-LoRA recipe

Start with the smallest useful stack:

| Control | Starting weight | Job |
| --- | ---: | --- |
| Character LoRA | `0.70–0.80` | Face and identity |
| UGC style LoRA | `0.25–0.35` | Phone/social aesthetic |
| Pose reference | `0.70–0.85` | Body placement and action |
| Direct reference | `0.25–0.45` | Composition or extra identity |

Usually include body variety in the Character LoRA instead of training a separate body LoRA.
Add an action LoRA around `0.30–0.50` only when pose guidance and prompting cannot reproduce a
specific repeated behavior.

Add one control at a time:

1. Base model
2. Character LoRA
3. UGC style LoRA
4. Pose reference
5. Optional action LoRA

If identity weakens, lower the style/action LoRA before raising every identity control.

## 9. Write the UGC prompt

Use:

```text
<trigger token>, <UGC format>, <action>, <product>, <location>,
<outfit>, <expression>, <lighting>, <camera treatment>
```

Example:

```text
maya_ugc_person, authentic smartphone UGC skincare demonstration,
holding a serum bottle beside her cheek in a bright bathroom,
casual neutral outfit, friendly smile, morning window light,
realistic skin, slightly imperfect handheld framing
```

## 10. Generate and test

- Use the matching model architecture.
- Start at the model's verified defaults.
- Keep the seed fixed while comparing weights.
- Change only one LoRA/reference weight per test.
- Generate several low-cost candidates before adding finishing.

Watch for:

- Identity drift
- Repeated training poses
- Stiff composition
- Bad hands or product interaction
- Overly polished advertising appearance
- Product label or packaging errors

## 11. Finish selected images

Only finish the best candidates:

1. Lock prompt, seed, weights, and references.
2. Enable Face polish if a medium/wide face is soft.
3. Review the polished face on the single final image.
4. Enable Real-ESRGAN for final detail if useful.
5. Confirm identity, anatomy, product, and exact canvas size.

Finishing sharpens an image; it does not repair a poor pose or bad dataset.

## 12. Turn it into a campaign

For one product, create:

- Three different hooks
- Two visual versions per hook
- A mix of demonstration, lifestyle, testimonial-style, and behind-the-scenes content
- Vertical TikTok versions
- Still images or short case-study threads for X

Use this simple funnel:

```text
TikTok demonstration or X case study
→ portfolio link
→ small paid pilot
→ monthly content package
```

Possible offers:

- UGC concept packs
- Finished image and video packs
- Monthly virtual-character content
- Private brand Character/LoRA setup
- White-label work for agencies

## 13. Publish transparently

- Describe the character as virtual or AI-generated.
- Label realistic AI content on TikTok.
- Use TikTok's Promotional Content or Paid Partnership disclosure when applicable.
- Use X's Paid Partnership disclosure for paid, gifted, or affiliate posts.
- Put `Ad`, `Sponsored`, or the relationship directly in the post/video when required.
- Do not impersonate a real person or fabricate a real product experience.

The best business positioning is an **AI-assisted UGC production studio**, not an undisclosed fake
influencer account.

## Default starting recipe

```text
Character LoRA: 0.75
UGC style LoRA: 0.30
Pose reference: 0.78
Direct reference: Off, or 0.30 when needed
Action LoRA: Off unless the action repeatedly fails
Face polish: Off during exploration
Neural detail: Final selections only
```
